#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const requireFromWeb = createRequire(path.join(root, "apps/web/package.json"));
const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodePacked,
  erc20Abi,
  formatUnits,
  http,
  keccak256,
  parseAbi,
} = requireFromWeb("viem");
const { privateKeyToAccount } = requireFromWeb("viem/accounts");

const ONE_USDC = 1_000_000n;
const DEFAULT_CREATION_BOND = 5n * ONE_USDC;
const DEFAULT_INITIAL_LIQUIDITY = 10n * ONE_USDC;
const DEFAULT_RESERVE_USDC = 1n * ONE_USDC;
const WORLD_CUP_WINNER_SEARCH =
  "https://gamma-api.polymarket.com/public-search?q=Will%20Spain%20win%20the%202026%20FIFA%20World%20Cup&limit_per_type=5&search_profiles=false&sort=volume&ascending=false";
const DEFAULT_TEAMS = [
  "Spain",
  "France",
  "Brazil",
  "Germany",
  "Portugal",
  "Argentina",
  "England",
  "Netherlands",
  "Italy",
  "Belgium",
  "Uruguay",
  "Mexico",
  "USA",
  "Croatia",
  "Morocco",
  "Japan",
];

const deploymentPath = path.join(root, "contracts/deployments/arc-testnet.json");
const latestPath = path.join(root, "contracts/deployments/arc-testnet-fifa-markets-latest.json");
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
const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

const usdc = deployment.contracts.usdc.address;
const factory = deployment.contracts.iknowMarketFactory.address;
const creationBond = parseBaseUnits(process.env.IKNOW_CREATION_BOND, DEFAULT_CREATION_BOND);
const initialLiquidity = parseBaseUnits(process.env.IKNOW_INITIAL_LIQUIDITY, DEFAULT_INITIAL_LIQUIDITY);
const reserveUsdc = parseBaseUnits(process.env.IKNOW_USDC_RESERVE, DEFAULT_RESERVE_USDC);
const requestedLimit = process.env.IKNOW_MARKET_LIMIT ? Number(process.env.IKNOW_MARKET_LIMIT) : Infinity;
const teams = (process.env.IKNOW_FIFA_TEAMS || DEFAULT_TEAMS.join(","))
  .split(",")
  .map((team) => team.trim())
  .filter(Boolean);

const factoryAbi = parseAbi([
  "event MarketCreated(address indexed market, address indexed creator, bytes32 indexed specHash, string metadataURI, uint256 closeTime, uint256 creationBond, uint256 initialLiquidity)",
  "function createMarket(bytes32 specHash, string metadataURI, uint256 closeTime, uint256 creationBond, uint256 initialLiquidity) returns (address marketAddr)",
]);
const marketAbi = parseAbi([
  "function reserves() view returns (uint256 yes, uint256 no)",
  "function yesTokenId() view returns (uint256)",
  "function noTokenId() view returns (uint256)",
]);

const polymarketMarkets = await fetchWorldCupWinnerMarkets();
const existingMarketKeys = new Set(
  (deployment.markets || []).flatMap((market) => [
    market.id?.toLowerCase(),
    market.question?.toLowerCase(),
    market.sourceIdea?.externalId ? `polymarket:${market.sourceIdea.externalId}` : undefined,
  ]).filter(Boolean),
);
const candidates = teams
  .map((team) => marketForTeam(polymarketMarkets, team))
  .filter(Boolean)
  .filter((market) => !existingMarketKeys.has(market.question.toLowerCase()))
  .filter((market) => !existingMarketKeys.has(`polymarket:${market.id}`));

const balance = await publicClient.readContract({
  address: usdc,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
const perMarketCost = creationBond + initialLiquidity;
const spendableBalance = balance > reserveUsdc ? balance - reserveUsdc : 0n;
const affordableCount = Number(spendableBalance / perMarketCost);
const createCount = Math.max(0, Math.min(candidates.length, affordableCount, requestedLimit));
const selected = candidates.slice(0, createCount);

console.log(`Creator: ${account.address}`);
console.log(`Factory: ${factory}`);
console.log(`USDC balance: ${formatUnits(balance, deployment.contracts.usdc.decimals)}`);
console.log(`Reserve: ${formatUnits(reserveUsdc, deployment.contracts.usdc.decimals)} USDC`);
console.log(`Per market: ${formatUnits(perMarketCost, deployment.contracts.usdc.decimals)} USDC`);
console.log(`Candidates after skipping existing: ${candidates.length}`);
console.log(`Creating: ${selected.length}`);

if (selected.length === 0) {
  console.log("No markets to create. Add USDC, lower IKNOW_USDC_RESERVE, or adjust IKNOW_FIFA_TEAMS.");
  process.exit(0);
}

const totalApproval = perMarketCost * BigInt(selected.length);
console.log(`Approving ${formatUnits(totalApproval, deployment.contracts.usdc.decimals)} USDC for market creation...`);
let hash = await walletClient.writeContract({
  address: usdc,
  abi: erc20Abi,
  functionName: "approve",
  args: [factory, totalApproval],
});
await publicClient.waitForTransactionReceipt({ hash });
console.log(`Approve tx: ${hash}`);

const createdMarkets = [];
for (const candidate of selected) {
  const spec = marketSpec(candidate);
  console.log(`Creating ${spec.question}...`);
  hash = await walletClient.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "createMarket",
    args: [spec.specHash, spec.metadataURI, BigInt(spec.closeTime), creationBond, initialLiquidity],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const marketLog = receipt.logs.find((log) => log.address.toLowerCase() === factory.toLowerCase());
  if (!marketLog) throw new Error(`MarketCreated log not found for ${spec.question}`);
  const decoded = decodeEventLog({ abi: factoryAbi, data: marketLog.data, topics: marketLog.topics });
  const marketAddress = decoded.args.market;
  const [yesReserve, noReserve] = await publicClient.readContract({
    address: marketAddress,
    abi: marketAbi,
    functionName: "reserves",
  });
  const yesTokenId = await publicClient.readContract({ address: marketAddress, abi: marketAbi, functionName: "yesTokenId" });
  const noTokenId = await publicClient.readContract({ address: marketAddress, abi: marketAbi, functionName: "noTokenId" });

  const market = {
    id: `${slugify(spec.question)}-${hash.slice(2, 8)}`,
    address: marketAddress,
    specHash: spec.specHash,
    metadataURI: spec.metadataURI,
    question: spec.question,
    closeTime: spec.closeTime,
    resolutionSource: spec.resolutionSource,
    invalidConditions: spec.invalidConditions,
    imageUrl: candidate.imageUrl,
    sourceIdea: {
      provider: "polymarket",
      externalId: candidate.id,
      url: candidate.sourceUrl,
      imageUrl: candidate.imageUrl,
      question: candidate.question,
      closeTime: new Date(spec.closeTime * 1000).toISOString(),
    },
    creationBond: creationBond.toString(),
    initialLiquidity: initialLiquidity.toString(),
    yesTokenId: yesTokenId.toString(),
    noTokenId: noTokenId.toString(),
  };

  createdMarkets.push({
    ...market,
    createTx: hash,
    yesReserve: yesReserve.toString(),
    noReserve: noReserve.toString(),
  });
  console.log(`Created ${market.address} (${hash})`);
}

const nextDeployment = {
  ...deployment,
  markets: [
    ...createdMarkets.map(({ createTx, yesReserve, noReserve, ...market }) => market),
    ...(deployment.markets || []).filter(
      (market) => !createdMarkets.some((created) => sameMarketRecord(market, created)),
    ),
  ],
};

fs.writeFileSync(deploymentPath, `${JSON.stringify(nextDeployment, null, 2)}\n`);
fs.writeFileSync(
  latestPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      creator: account.address,
      factory,
      usdc,
      createdAt: new Date().toISOString(),
      markets: createdMarkets,
    },
    null,
    2,
  )}\n`,
);

const finalBalance = await publicClient.readContract({
  address: usdc,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});
console.log(`Deployment markets updated: ${deploymentPath}`);
console.log(`Latest artifact: ${latestPath}`);
console.log(`Final USDC balance: ${formatUnits(finalBalance, deployment.contracts.usdc.decimals)}`);

async function fetchWorldCupWinnerMarkets() {
  const response = await fetch(WORLD_CUP_WINNER_SEARCH, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Polymarket fetch failed with ${response.status}`);
  }
  const payload = await response.json();
  const markets = [];
  for (const event of payload.events || []) {
    if (event.slug !== "world-cup-winner") continue;
    for (const market of event.markets || []) {
      const outcomes = parseOutcomes(market.outcomes);
      if (outcomes.length !== 2 || outcomes[0].toLowerCase() !== "yes" || outcomes[1].toLowerCase() !== "no") {
        continue;
      }
      markets.push({
        id: String(market.id),
        question: cleanText(market.question),
        closeTime: parseCloseTime(market.endDateIso || market.endDate),
        description: cleanText(market.description || market.rules),
        imageUrl: cleanText(market.image || market.icon) || undefined,
        sourceUrl: market.slug ? `https://polymarket.com/market/${market.slug}` : undefined,
      });
    }
  }
  return markets;
}

function marketForTeam(markets, team) {
  const normalizedTeam = normalize(team);
  return markets.find((market) => normalize(market.question) === normalize(`Will ${team} win the 2026 FIFA World Cup?`))
    || markets.find((market) => normalize(market.question).includes(`will ${normalizedTeam} win the 2026 fifa world cup`));
}

function marketSpec(candidate) {
  const closeTimeIso = new Date(candidate.closeTime * 1000).toISOString();
  const team = candidate.question.replace(/^Will /, "").replace(/ win the 2026 FIFA World Cup\?$/, "");
  const resolutionSource =
    `Official information from FIFA for the 2026 FIFA World Cup. YES resolves if FIFA declares ${team} the winner of the 2026 FIFA World Cup. NO resolves if another national team wins, or if ${team} is eliminated or otherwise cannot win under FIFA rules. If official FIFA information is unavailable, use consensus reporting from major credible sports outlets.`;
  const invalidConditions = [
    "The result cannot be objectively checked from FIFA official information or credible sports reporting.",
    "If the 2026 FIFA World Cup is permanently canceled or has not been completed by October 13, 2026 at 11:59 PM UTC, resolve to INVALID.",
    "If FIFA changes tournament rules in a way that makes this winner market ambiguous or non-binary, resolve to INVALID.",
  ];
  const specHashInput = {
    question: candidate.question,
    outcomes: ["YES", "NO"],
    closeTime: closeTimeIso,
    resolutionSource,
    invalidConditions,
  };
  const specHash = `0x${crypto.createHash("sha256").update(JSON.stringify(specHashInput)).digest("hex")}`;
  return {
    question: candidate.question,
    closeTime: candidate.closeTime,
    resolutionSource,
    invalidConditions,
    specHash,
    metadataURI: `urn:iknow:market:${specHash}`,
  };
}

function parseBaseUnits(raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(String(raw))) throw new Error(`Invalid base-unit amount: ${raw}`);
  return BigInt(raw);
}

function parseOutcomes(value) {
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  return Array.isArray(parsed) ? parsed.flatMap((entry) => typeof entry === "string" ? [entry] : []) : [];
}

function parseCloseTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid close time: ${value}`);
  return Math.floor(timestamp / 1000);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function outcomeTokenId(market, outcome) {
  return BigInt(keccak256(encodePacked(["address", "uint8"], [market, outcome]))).toString();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function normalize(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function sameMarketRecord(a, b) {
  return a.address?.toLowerCase() === b.address?.toLowerCase()
    || a.id === b.id
    || a.question?.toLowerCase() === b.question?.toLowerCase()
    || (a.sourceIdea?.externalId && a.sourceIdea.externalId === b.sourceIdea?.externalId);
}
