import { iknowMarketAbi } from "@iknow/abis";
import type { DeployedMarket, LocalDeployment } from "@iknow/shared";
import { createPublicClient, createWalletClient, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { MarketSnapshot, MarketStateName, OutcomeName } from "./types.js";

const stateNames: MarketStateName[] = ["Open", "Closed", "Proposed", "Resolved"];
const outcomeNames: OutcomeName[] = ["Unresolved", "Yes", "No", "Invalid"];

export function chainFor(deployment: LocalDeployment): Chain {
  return {
    id: deployment.chain.id,
    name: deployment.chain.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [deployment.chain.rpcUrl] },
    },
  };
}

export function publicClientFor(deployment: LocalDeployment) {
  return createPublicClient({
    chain: chainFor(deployment),
    transport: http(deployment.chain.rpcUrl),
  });
}

export function resolverWalletFor(deployment: LocalDeployment) {
  const account = privateKeyToAccount(deployment.actors.resolver.privateKey as `0x${string}`);
  return createWalletClient({
    account,
    chain: chainFor(deployment),
    transport: http(deployment.chain.rpcUrl),
  });
}

export async function readMarketSnapshot(deployment: LocalDeployment, market: DeployedMarket): Promise<MarketSnapshot> {
  const client = publicClientFor(deployment);
  const address = market.address as Address;
  const [block, state, proposedOutcome, finalOutcome, finalizeAfter, evidenceURI, creatorFeePool, closeTime] =
    await Promise.all([
      client.getBlock(),
      client.readContract({ address, abi: iknowMarketAbi, functionName: "state" }),
      client.readContract({ address, abi: iknowMarketAbi, functionName: "proposedOutcome" }),
      client.readContract({ address, abi: iknowMarketAbi, functionName: "finalOutcome" }),
      client.readContract({ address, abi: iknowMarketAbi, functionName: "finalizeAfter" }),
      client.readContract({ address, abi: iknowMarketAbi, functionName: "evidenceURI" }),
      client.readContract({ address, abi: iknowMarketAbi, functionName: "creatorFeePool" }),
      client.readContract({ address, abi: iknowMarketAbi, functionName: "closeTime" }),
    ]);

  const stateNumber = Number(state);
  const proposedOutcomeNumber = Number(proposedOutcome);
  const finalOutcomeNumber = Number(finalOutcome);

  return {
    id: market.id,
    address,
    question: market.question,
    closeTime,
    state: stateNumber,
    stateName: stateNames[stateNumber] ?? "Open",
    proposedOutcome: proposedOutcomeNumber,
    proposedOutcomeName: outcomeNames[proposedOutcomeNumber] ?? "Unresolved",
    finalOutcome: finalOutcomeNumber,
    finalOutcomeName: outcomeNames[finalOutcomeNumber] ?? "Unresolved",
    finalizeAfter,
    evidenceURI,
    creatorFeePool,
    blockTimestamp: block.timestamp,
  };
}

export async function proposeResolution(
  deployment: LocalDeployment,
  market: DeployedMarket,
  outcome: 1 | 2 | 3,
  evidenceURI: string,
): Promise<`0x${string}`> {
  const wallet = resolverWalletFor(deployment);
  const hash = await wallet.writeContract({
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "proposeResolution",
    args: [outcome, evidenceURI],
  });
  await publicClientFor(deployment).waitForTransactionReceipt({ hash });
  return hash;
}

export async function finalizeResolution(deployment: LocalDeployment, market: DeployedMarket): Promise<`0x${string}`> {
  const wallet = resolverWalletFor(deployment);
  const hash = await wallet.writeContract({
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "finalizeResolution",
  });
  await publicClientFor(deployment).waitForTransactionReceipt({ hash });
  return hash;
}
