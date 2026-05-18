import "dotenv/config";
import { iknowMarketAbi, outcomeTokenAbi } from "@iknow/abis";
import type { LocalActor, LocalDeployment } from "@iknow/shared";
import { createWalletClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { postEvidencePacket } from "./api.js";
import { chainFor, finalizeResolution, proposeResolution, publicClientFor, readMarketSnapshot } from "./chain.js";
import { readDeployment, defaultDeploymentPath } from "./deployment.js";
import { buildEvidencePacket } from "./evidenceSource.js";
import { buildLlmEvidencePacket } from "./llmEvidenceSource.js";
import { canPrepareEvidence, defaultPolicy, outcomeToContractValue } from "./policy.js";
import type { EvidencePacket } from "./types.js";

const erc20Abi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

type BrainMode = "mock" | "llm";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const deployment = await readDeployment(options.deploymentPath);
  const market = deployment.markets.find((candidate) => candidate.id === options.marketId);
  if (!market) throw new Error(`Market not found: ${options.marketId}`);

  const marketAddress = market.address as Address;
  const client = publicClientFor(deployment);
  const initial = await readMarketSnapshot(deployment, market);

  if (initial.stateName === "Open" && initial.blockTimestamp < initial.closeTime) {
    await warpTo(deployment, initial.closeTime + 1n);
  }

  const snapshot = await readMarketSnapshot(deployment, market);
  const packet = await buildPacket(options.brain, deployment, market.id);
  const policy = canPrepareEvidence(packet, options.minConfidence);
  assert(policy.allowed, `evidence policy refused: ${policy.reasons.join("; ")}`);

  const posted = await postEvidencePacket(packet, options.apiBaseUrl);
  assert(posted.ok, `evidence post failed: ${posted.status} ${"message" in posted ? posted.message : ""}`);

  const proposedHash = await proposeResolution(
    deployment,
    market,
    outcomeToContractValue(packet.suggestedOutcome),
    posted.evidenceURI,
  );
  const proposed = await readMarketSnapshot(deployment, market);
  assert(proposed.stateName === "Proposed", `expected Proposed, got ${proposed.stateName}`);
  assert(proposed.evidenceURI === posted.evidenceURI, "on-chain evidence URI mismatch");

  await warpTo(deployment, proposed.finalizeAfter + 1n);
  const finalizedHash = await finalizeResolution(deployment, market);
  const resolved = await readMarketSnapshot(deployment, market);
  assert(resolved.stateName === "Resolved", `expected Resolved, got ${resolved.stateName}`);
  assert(resolved.finalOutcomeName === "Yes", `expected YES resolution, got ${resolved.finalOutcomeName}`);

  const traderYesBefore = await usdcBalance(deployment, deployment.actors.traderYes.address);
  const traderYesRedeemHash = await writeMarket(deployment, deployment.actors.traderYes, marketAddress, "redeem", []);
  const traderYesAfter = await usdcBalance(deployment, deployment.actors.traderYes.address);
  assert(traderYesAfter > traderYesBefore, "winning YES trader did not receive USDC");

  const lpShares = await client.readContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "lpShares",
    args: [deployment.actors.liquidityProvider.address as Address],
  });
  const lpBeforeRemove = await usdcBalance(deployment, deployment.actors.liquidityProvider.address);
  const lpRemoveHash = await writeMarket(deployment, deployment.actors.liquidityProvider, marketAddress, "removeLiquidity", [
    lpShares,
    0n,
    0n,
  ]);
  const lpAfterRemove = await usdcBalance(deployment, deployment.actors.liquidityProvider.address);
  assert(lpAfterRemove > lpBeforeRemove, "LP did not receive accrued USDC fees on remove");

  const lpYes = await outcomeBalance(deployment, deployment.actors.liquidityProvider.address, BigInt(market.yesTokenId));
  let lpRedeemHash = "";
  if (lpYes > 0n) {
    const lpBeforeRedeem = await usdcBalance(deployment, deployment.actors.liquidityProvider.address);
    lpRedeemHash = await writeMarket(deployment, deployment.actors.liquidityProvider, marketAddress, "redeem", []);
    const lpAfterRedeem = await usdcBalance(deployment, deployment.actors.liquidityProvider.address);
    assert(lpAfterRedeem > lpBeforeRedeem, "LP winning outcome tokens did not redeem to USDC");
  }

  const creatorFeePool = await client.readContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "creatorFeePool",
  });
  const creatorBefore = await usdcBalance(deployment, deployment.actors.creator.address);
  const creatorFeeHash = await writeMarket(deployment, deployment.actors.creator, marketAddress, "claimCreatorFees", [
    deployment.actors.creator.address,
    creatorFeePool,
  ]);
  const creatorAfterFee = await usdcBalance(deployment, deployment.actors.creator.address);
  assert(creatorAfterFee > creatorBefore, "creator did not receive creator fees");

  const creationBond = await client.readContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "creationBond",
  });
  const creatorBondHash = await writeMarket(deployment, deployment.actors.creator, marketAddress, "claimCreationBond", [
    deployment.actors.creator.address,
  ]);
  const creatorAfterBond = await usdcBalance(deployment, deployment.actors.creator.address);
  assert(creatorAfterBond >= creatorAfterFee + creationBond, "creator did not receive creation bond");

  const protocolFeePool = await client.readContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "protocolFeePool",
  });
  const protocolBefore = await usdcBalance(deployment, deployment.actors.protocol.address);
  const protocolFeeHash = await writeMarket(deployment, deployment.actors.protocol, marketAddress, "claimProtocolFees", [
    deployment.actors.protocol.address,
    protocolFeePool,
  ]);
  const protocolAfter = await usdcBalance(deployment, deployment.actors.protocol.address);
  assert(protocolAfter > protocolBefore, "protocol did not receive protocol fees");

  console.log(
    JSON.stringify(
      {
        ok: true,
        marketId: market.id,
        brain: options.brain,
        suggestedOutcome: packet.suggestedOutcome,
        confidence: packet.confidence,
        evidenceURI: posted.evidenceURI,
        transactions: {
          proposed: proposedHash,
          finalized: finalizedHash,
          traderYesRedeem: traderYesRedeemHash,
          lpRemove: lpRemoveHash,
          lpRedeem: lpRedeemHash || null,
          creatorFees: creatorFeeHash,
          creatorBond: creatorBondHash,
          protocolFees: protocolFeeHash,
        },
        payouts: {
          traderYes: (traderYesAfter - traderYesBefore).toString(),
          lpFeesOnRemove: (lpAfterRemove - lpBeforeRemove).toString(),
          creatorFees: (creatorAfterFee - creatorBefore).toString(),
          creatorBond: (creatorAfterBond - creatorAfterFee).toString(),
          protocolFees: (protocolAfter - protocolBefore).toString(),
        },
        previousSnapshotState: snapshot.stateName,
      },
      null,
      2,
    ),
  );
}

async function buildPacket(brain: BrainMode, deployment: LocalDeployment, marketId: string): Promise<EvidencePacket> {
  const market = deployment.markets.find((candidate) => candidate.id === marketId);
  if (!market) throw new Error(`Market not found: ${marketId}`);
  const snapshot = await readMarketSnapshot(deployment, market);
  if (brain === "llm") {
    return buildLlmEvidencePacket(market, snapshot, "iknow-resolver-minimax");
  }

  const packet = buildEvidencePacket(market, snapshot, "iknow-resolver-local");
  if (!packet) throw new Error("Mock resolver could not build an evidence packet");
  return packet;
}

async function writeMarket(
  deployment: LocalDeployment,
  actor: LocalActor,
  marketAddress: Address,
  functionName: "redeem" | "removeLiquidity" | "claimCreatorFees" | "claimCreationBond" | "claimProtocolFees",
  args: readonly unknown[],
) {
  const account = privateKeyToAccount(actor.privateKey as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: chainFor(deployment),
    transport: http(deployment.chain.rpcUrl),
  });
  const hash = await wallet.writeContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName,
    args: args as never,
  });
  await publicClientFor(deployment).waitForTransactionReceipt({ hash });
  return hash;
}

async function usdcBalance(deployment: LocalDeployment, address: string) {
  return publicClientFor(deployment).readContract({
    address: deployment.contracts.mockUSDC.address as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as Address],
  });
}

async function outcomeBalance(deployment: LocalDeployment, address: string, tokenId: bigint) {
  return publicClientFor(deployment).readContract({
    address: deployment.contracts.outcomeToken.address as Address,
    abi: outcomeTokenAbi,
    functionName: "balanceOf",
    args: [address as Address, tokenId],
  });
}

async function warpTo(deployment: LocalDeployment, timestamp: bigint) {
  await rpc(deployment, "evm_setNextBlockTimestamp", [Number(timestamp)]);
  await rpc(deployment, "evm_mine", []);
}

async function rpc(deployment: LocalDeployment, method: string, params: unknown[]) {
  const response = await fetch(deployment.chain.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? `${method} failed`);
}

function parseArgs(args: string[]) {
  const options = {
    deploymentPath: process.env.DEPLOYMENT_PATH ?? defaultDeploymentPath,
    apiBaseUrl: process.env.API_BASE_URL ?? "http://127.0.0.1:8787",
    marketId: "epl-arsenal-chelsea",
    brain: "llm" as BrainMode,
    minConfidence: defaultPolicy.minConfidence,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--deployment") options.deploymentPath = requireValue(args, ++index, arg);
    else if (arg === "--api-base-url") options.apiBaseUrl = requireValue(args, ++index, arg);
    else if (arg === "--market") options.marketId = requireValue(args, ++index, arg);
    else if (arg === "--brain") options.brain = parseBrain(requireValue(args, ++index, arg));
    else if (arg === "--min-confidence") options.minConfidence = Number(requireValue(args, ++index, arg));
    else if (arg === "--") continue;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function parseBrain(value: string): BrainMode {
  if (value === "mock" || value === "llm") return value;
  throw new Error(`Invalid --brain value: ${value}`);
}

function requireValue(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
