#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const requireFromWeb = createRequire(path.join(root, "apps/web/package.json"));
const {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  decodeEventLog,
} = requireFromWeb("viem");
const { privateKeyToAccount } = requireFromWeb("viem/accounts");

const deploymentPath = path.join(root, "contracts/deployments/arc-testnet.json");
const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  console.error("PRIVATE_KEY is required. Export the funded Arc testnet creator key before running.");
  process.exit(1);
}

const rpcUrl = process.env.ARC_TESTNET_RPC_URL || process.env.RPC || deployment.chain.rpcUrl;
const chain = {
  id: deployment.chain.id,
  name: deployment.chain.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

const usdc = deployment.contracts.usdc.address;
const factory = deployment.contracts.iknowMarketFactory.address;
const marketId = process.env.IKNOW_MARKET_ID || "arc-smoke-test";
const question = process.env.IKNOW_MARKET_QUESTION || "Will this Arc testnet smoke market resolve YES?";
const metadataURI = process.env.IKNOW_MARKET_METADATA_URI || "urn:iknow:market:arc-smoke-test";
const resolutionSource =
  process.env.IKNOW_MARKET_RESOLUTION_SOURCE || "Manual smoke-test source controlled by the iknow demo resolver.";
const invalidCondition =
  process.env.IKNOW_MARKET_INVALID_CONDITION ||
  "Resolve INVALID only if the test market was created with malformed metadata.";
const closeTime = BigInt(process.env.IKNOW_MARKET_CLOSE_TIME || Math.floor(Date.now() / 1000) + 10 * 60);
const creationBond = BigInt(process.env.IKNOW_CREATION_BOND || 5_000_000);
const initialLiquidity = BigInt(process.env.IKNOW_INITIAL_LIQUIDITY || 10_000_000);
const smokeBuy = BigInt(process.env.IKNOW_SMOKE_BUY_USDC || 1_000_000);
const specHash = keccak256(
  encodeAbiParameters(
    [
      { type: "string" },
      { type: "string" },
      { type: "string" },
      { type: "string" },
      { type: "string" },
      { type: "uint256" },
    ],
    [marketId, question, metadataURI, resolutionSource, invalidCondition, closeTime],
  ),
);

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
const factoryAbi = parseAbi([
  "event MarketCreated(address indexed market, address indexed creator, bytes32 indexed specHash, string metadataURI, uint256 closeTime, uint256 creationBond, uint256 initialLiquidity)",
  "function createMarket(bytes32 specHash, string metadataURI, uint256 closeTime, uint256 creationBond, uint256 initialLiquidity) returns (address marketAddr)",
]);
const marketAbi = parseAbi([
  "function buyYes(uint256 usdcIn, uint256 minYesOut) returns (uint256 yesOut)",
  "function reserves() view returns (uint256 yes, uint256 no)",
  "function yesTokenId() view returns (uint256)",
  "function noTokenId() view returns (uint256)",
]);

const required = creationBond + initialLiquidity + smokeBuy;
const balance = await publicClient.readContract({
  address: usdc,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
if (balance < required) {
  throw new Error(`Insufficient USDC. Need ${required}, wallet has ${balance}.`);
}

console.log(`Creator: ${account.address}`);
console.log(`Factory: ${factory}`);
console.log(`Approving ${creationBond + initialLiquidity} USDC base units for market creation...`);
let hash = await walletClient.writeContract({
  address: usdc,
  abi: erc20Abi,
  functionName: "approve",
  args: [factory, creationBond + initialLiquidity],
});
await publicClient.waitForTransactionReceipt({ hash });
console.log(`Approve tx: ${hash}`);

console.log("Creating market...");
hash = await walletClient.writeContract({
  address: factory,
  abi: factoryAbi,
  functionName: "createMarket",
  args: [specHash, metadataURI, closeTime, creationBond, initialLiquidity],
});
const createReceipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`Create tx: ${hash}`);

const marketLog = createReceipt.logs
  .find((log) => log.address.toLowerCase() === factory.toLowerCase());
if (!marketLog) throw new Error("MarketCreated log not found.");
const decoded = decodeEventLog({ abi: factoryAbi, data: marketLog.data, topics: marketLog.topics });
const market = decoded.args.market;
console.log(`Market: ${market}`);

if (smokeBuy !== 0n) {
  console.log(`Approving ${smokeBuy} USDC base units for smoke YES buy...`);
  hash = await walletClient.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [market, smokeBuy],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Trade approve tx: ${hash}`);

  console.log("Buying YES...");
  hash = await walletClient.writeContract({
    address: market,
    abi: marketAbi,
    functionName: "buyYes",
    args: [smokeBuy, 0n],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Buy YES tx: ${hash}`);
}

const [yesReserve, noReserve] = await publicClient.readContract({
  address: market,
  abi: marketAbi,
  functionName: "reserves",
});
const yesTokenId = await publicClient.readContract({ address: market, abi: marketAbi, functionName: "yesTokenId" });
const noTokenId = await publicClient.readContract({ address: market, abi: marketAbi, functionName: "noTokenId" });

const artifact = {
  schemaVersion: 1,
  creator: account.address,
  factory,
  usdc,
  market,
  id: marketId,
  question,
  metadataURI,
  resolutionSource,
  invalidCondition,
  specHash,
  closeTime: Number(closeTime),
  creationBond: creationBond.toString(),
  initialLiquidity: initialLiquidity.toString(),
  smokeBuy: smokeBuy.toString(),
  yesReserve: yesReserve.toString(),
  noReserve: noReserve.toString(),
  yesTokenId: yesTokenId.toString(),
  noTokenId: noTokenId.toString(),
};
const outPath = path.join(root, "contracts/deployments/arc-testnet-market-latest.json");
fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
upsertMarketInDeployment(artifact);
console.log(`Artifact: ${outPath}`);
console.log(`Deployment markets updated: ${deploymentPath}`);

function upsertMarketInDeployment(created) {
  const market = {
    id: created.id,
    address: created.market,
    specHash: created.specHash,
    metadataURI: created.metadataURI,
    question: created.question,
    closeTime: created.closeTime,
    resolutionSource: created.resolutionSource,
    invalidConditions: [created.invalidCondition],
    sourceIdea: {
      provider: "iknow-arc-testnet-smoke",
      externalId: created.id,
      question: created.question,
      closeTime: new Date(created.closeTime * 1000).toISOString(),
    },
    creationBond: created.creationBond,
    initialLiquidity: created.initialLiquidity,
    yesTokenId: created.yesTokenId,
    noTokenId: created.noTokenId,
  };

  const nextDeployment = {
    ...deployment,
    markets: [market, ...(deployment.markets || []).filter((item) => item.id !== market.id && item.address !== market.address)],
  };

  fs.writeFileSync(deploymentPath, `${JSON.stringify(nextDeployment, null, 2)}\n`);
}
