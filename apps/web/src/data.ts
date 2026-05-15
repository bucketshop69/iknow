import {
  arcTestnet,
  localDeploymentSchema,
  marketDraftResponseSchema,
  marketDraftSchema,
  type LocalDeployment,
  type MarketDraftResponse,
} from "@iknow/shared";
import {
  deployedAddresses,
  iknowMarketAbi,
  iknowMarketFactoryAbi,
  outcomeTokenAbi,
} from "@iknow/abis";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  maxUint256,
  parseAbi,
  parseUnits,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  Address,
  ContractSurface,
  CreateDraftInput,
  DevActor,
  DevActorRole,
  MarketReadModel,
  PortfolioReadModel,
} from "./types";

type AbiEntry = { type?: string; name?: string };

export const apiBaseUrl = import.meta.env.VITE_IKNOW_API_URL ?? "http://127.0.0.1:8787";

const addressOrUndefined = (value: unknown): Address | undefined => {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    return undefined;
  }

  return value as Address;
};

const functionNames = (abi: readonly AbiEntry[]) =>
  abi
    .filter((entry) => entry.type === "function" && entry.name)
    .map((entry) => entry.name!)
    .sort();

const shortId = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export async function loadLocalDeployment(): Promise<LocalDeployment | null> {
  const response = await fetch(`${apiBaseUrl}/local/deployment`);
  if (!response.ok) {
    return null;
  }

  return localDeploymentSchema.parse(await response.json());
}

export const contractSurface = (deployment: LocalDeployment | null): ContractSurface => {
  if (deployment) {
    return {
      chainId: deployment.chain.id,
      chainName: deployment.chain.name,
      rpcUrl: deployment.chain.rpcUrl,
      explorerUrl: "",
      marketFactory: deployment.contracts.iknowMarketFactory.address as Address,
      outcomeToken: deployment.contracts.outcomeToken.address as Address,
      abiSummary: abiSummary(),
    };
  }

  return {
    chainId: arcTestnet.id,
    chainName: arcTestnet.name,
    rpcUrl: arcTestnet.rpcUrl,
    explorerUrl: arcTestnet.explorerUrl,
    marketFactory: addressOrUndefined(deployedAddresses.arcTestnet.marketFactory),
    outcomeToken: addressOrUndefined(deployedAddresses.arcTestnet.outcomeToken),
    abiSummary: abiSummary(),
  };
};

function abiSummary() {
  return {
    factoryFunctions: functionNames(iknowMarketFactoryAbi),
    marketFunctions: functionNames(iknowMarketAbi),
    outcomeTokenFunctions: functionNames(outcomeTokenAbi),
  };
}

export const fallbackDevActors: DevActor[] = [
  {
    id: "creator",
    name: "Creator",
    role: "Creator",
    address: "0x1000000000000000000000000000000000000001",
    usdcBalance: "Local deployment not loaded",
  },
  {
    id: "traderYes",
    name: "TraderYes",
    role: "TraderYes",
    address: "0x1000000000000000000000000000000000000002",
    usdcBalance: "Local deployment not loaded",
  },
  {
    id: "liquidityProvider",
    name: "LiquidityProvider",
    role: "LiquidityProvider",
    address: "0x1000000000000000000000000000000000000003",
    usdcBalance: "Local deployment not loaded",
  },
  {
    id: "resolver",
    name: "Resolver",
    role: "Resolver",
    address: "0x1000000000000000000000000000000000000004",
    usdcBalance: "Local deployment not loaded",
  },
];

const actorLabels: Record<keyof LocalDeployment["actors"], { name: string; role: DevActorRole; usdcBalance: string }> = {
  deployer: { name: "Deployer", role: "Deployer", usdcBalance: "MockUSDC minter" },
  creator: { name: "Creator", role: "Creator", usdcBalance: "100,000 seeded" },
  traderYes: { name: "TraderYes", role: "TraderYes", usdcBalance: "25,000 seeded" },
  traderNo: { name: "TraderNo", role: "TraderNo", usdcBalance: "25,000 seeded" },
  liquidityProvider: { name: "LiquidityProvider", role: "LiquidityProvider", usdcBalance: "100,000 seeded" },
  resolver: { name: "Resolver", role: "Resolver", usdcBalance: "Resolver only" },
  protocol: { name: "Protocol", role: "Protocol", usdcBalance: "Fee recipient" },
};

export function devActorsFromDeployment(deployment: LocalDeployment | null): DevActor[] {
  if (!deployment) {
    return fallbackDevActors;
  }

  return Object.entries(deployment.actors).map(([id, actor]) => ({
    id,
    address: actor.address as Address,
    ...actorLabels[id as keyof LocalDeployment["actors"]],
  }));
}

const fallbackMarkets: MarketReadModel[] = [
  {
    id: "local-not-loaded",
    address: undefined,
    question: "Start Anvil and run pnpm chain:deploy to load seeded markets",
    status: "Open",
    closeTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    resolutionSource: "Local deployment artifact",
    invalidConditions: ["Local deployment artifact is missing."],
    metadataURI: "local://missing",
    specHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    creator: "Creator",
    yesPrice: 0.5,
    noPrice: 0.5,
    liquidity: "0 USDC",
    yesReserve: "0 YES",
    noReserve: "0 NO",
    volume24h: "0 USDC",
  },
];

export function marketsFromDeployment(deployment: LocalDeployment | null): MarketReadModel[] {
  if (!deployment) {
    return fallbackMarkets;
  }

  return deployment.markets.map((market, index) => ({
    id: market.id || shortId(market.question),
    address: market.address as Address,
    question: market.question,
    status: index === 0 ? "Open" : "Open",
    closeTime: new Date(market.closeTime * 1000).toISOString(),
    resolutionSource: "Local seed artifact; replace with market metadata in the next API pass.",
    invalidConditions: ["Local demo market metadata is unavailable."],
    metadataURI: market.metadataURI,
    specHash: market.specHash as `0x${string}`,
    creator: "Creator",
    yesPrice: index === 0 ? 0.5 : 0.5,
    noPrice: index === 0 ? 0.5 : 0.5,
    liquidity: `${Number(BigInt(market.initialLiquidity) / 1_000_000n).toLocaleString()} USDC`,
    yesReserve: `${Number(BigInt(market.initialLiquidity) / 1_000_000n).toLocaleString()} YES`,
    noReserve: `${Number(BigInt(market.initialLiquidity) / 1_000_000n).toLocaleString()} NO`,
    volume24h: index === 0 ? "200 USDC seeded" : "0 USDC",
  }));
}

export interface MarketDataSource {
  listMarkets: () => MarketReadModel[];
  getMarket: (marketId: string) => MarketReadModel | undefined;
  getPortfolio: (actorId: string) => PortfolioReadModel;
  buildDraftPreview: (input: CreateDraftInput) => Promise<MarketDraftResponse>;
  executeCreateMarket: (actorId: string, draft: MarketDraftResponse) => Promise<Hex>;
  executeBuy: (actorId: string, marketId: string, side: "YES" | "NO", usdcAmount: string) => Promise<Hex>;
  executeAddLiquidity: (actorId: string, marketId: string, usdcAmount: string) => Promise<Hex>;
}

export function createMarketDataSource(deployment: LocalDeployment | null, actors: DevActor[]): MarketDataSource {
  const markets = marketsFromDeployment(deployment);

  return {
    listMarkets: () => markets,
    getMarket: (marketId) => markets.find((market) => market.id === marketId),
    getPortfolio: (actorId) => {
      const actor = actors.find((candidate) => candidate.id === actorId) ?? actors[0];
      const positions = actor.role === "LiquidityProvider"
        ? markets.slice(0, 1).map((market) => ({
            marketId: market.id,
            marketQuestion: market.question,
            yesShares: "0",
            noShares: "0",
            lpShares: "500 seeded",
            claimable: "LP fees pending",
          }))
        : actor.role === "TraderYes"
          ? markets.slice(0, 1).map((market) => ({
              marketId: market.id,
              marketQuestion: market.question,
              yesShares: "Seeded buy",
              noShares: "0",
              lpShares: "0",
              claimable: "Pending resolution",
            }))
          : [];

      return {
        actor,
        positions,
        totals: {
          yesMarkets: positions.filter((position) => position.yesShares !== "0").length,
          noMarkets: positions.filter((position) => position.noShares !== "0").length,
          lpMarkets: positions.filter((position) => position.lpShares !== "0").length,
          claimable: positions.length > 0 ? "Open" : "0 USDC",
        },
      };
    },
    buildDraftPreview,
    executeCreateMarket: (actorId, draft) => executeCreateMarket(deployment, actorId, draft),
    executeBuy: (actorId, marketId, side, usdcAmount) => executeBuy(deployment, actorId, marketId, side, usdcAmount),
    executeAddLiquidity: (actorId, marketId, usdcAmount) =>
      executeAddLiquidity(deployment, actorId, marketId, usdcAmount),
  };
}

const erc20Abi = parseAbi(["function approve(address spender,uint256 value) returns (bool)"]);

function requireDeployment(deployment: LocalDeployment | null): LocalDeployment {
  if (!deployment) {
    throw new Error("Local deployment is not loaded. Run pnpm chain:anvil, pnpm chain:deploy, and pnpm dev:api.");
  }

  return deployment;
}

function actorAccount(deployment: LocalDeployment, actorId: string) {
  const actor = deployment.actors[actorId as keyof LocalDeployment["actors"]];
  if (!actor) {
    throw new Error(`Unknown local actor: ${actorId}`);
  }

  return privateKeyToAccount(actor.privateKey as Hex);
}

function localChain(deployment: LocalDeployment) {
  return {
    id: deployment.chain.id,
    name: deployment.chain.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [deployment.chain.rpcUrl] } },
  } as const;
}

function clients(deployment: LocalDeployment, actorId: string) {
  const chain = localChain(deployment);
  return {
    publicClient: createPublicClient({ chain, transport: http(deployment.chain.rpcUrl) }),
    walletClient: createWalletClient({
      account: actorAccount(deployment, actorId),
      chain,
      transport: http(deployment.chain.rpcUrl),
    }),
  };
}

async function waitForSuccess(deployment: LocalDeployment, hash: Hex): Promise<Hex> {
  const publicClient = createPublicClient({
    chain: localChain(deployment),
    transport: http(deployment.chain.rpcUrl),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction failed: ${hash}`);
  }

  return hash;
}

async function approveUsdc(deployment: LocalDeployment, actorId: string, spender: Address, amount: bigint) {
  const { walletClient } = clients(deployment, actorId);
  const hash = await walletClient.writeContract({
    address: deployment.contracts.mockUSDC.address as Address,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
  await waitForSuccess(deployment, hash);
}

async function executeCreateMarket(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  draft: MarketDraftResponse,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const factory = deployment.contracts.iknowMarketFactory.address as Address;
  const { walletClient } = clients(deployment, actorId);
  const totalUsdc = BigInt(draft.factoryArgs.creationBond) + BigInt(draft.factoryArgs.initialLiquidity);

  await approveUsdc(deployment, actorId, factory, totalUsdc);

  const hash = await walletClient.writeContract({
    address: factory,
    abi: iknowMarketFactoryAbi,
    functionName: "createMarket",
    args: [
      draft.factoryArgs.specHash as Hex,
      draft.factoryArgs.metadataURI,
      BigInt(draft.factoryArgs.closeTime),
      BigInt(draft.factoryArgs.creationBond),
      BigInt(draft.factoryArgs.initialLiquidity),
    ],
  });

  return waitForSuccess(deployment, hash);
}

async function executeBuy(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
  side: "YES" | "NO",
  usdcAmount: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = deployment.markets.find((candidate) => candidate.id === marketId);
  if (!market) {
    throw new Error(`Unknown market: ${marketId}`);
  }
  const amount = parseUnits(usdcAmount || "0", deployment.contracts.mockUSDC.decimals);
  if (amount <= 0n) {
    throw new Error("Amount must be greater than zero");
  }
  const marketAddress = market.address as Address;
  const { walletClient } = clients(deployment, actorId);

  await approveUsdc(deployment, actorId, marketAddress, amount);

  const hash = await walletClient.writeContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: side === "YES" ? "buyYes" : "buyNo",
    args: [amount, 0n],
  });

  return waitForSuccess(deployment, hash);
}

async function executeAddLiquidity(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
  usdcAmount: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = deployment.markets.find((candidate) => candidate.id === marketId);
  if (!market) {
    throw new Error(`Unknown market: ${marketId}`);
  }
  const amount = parseUnits(usdcAmount || "0", deployment.contracts.mockUSDC.decimals);
  if (amount <= 0n) {
    throw new Error("Amount must be greater than zero");
  }
  const marketAddress = market.address as Address;
  const { walletClient } = clients(deployment, actorId);

  await approveUsdc(deployment, actorId, marketAddress, maxUint256);

  const hash = await walletClient.writeContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "addLiquidity",
    args: [amount, 0n],
  });

  return waitForSuccess(deployment, hash);
}

async function buildDraftPreview(input: CreateDraftInput): Promise<MarketDraftResponse> {
  const invalidConditions = input.invalidConditions
    .split("\n")
    .map((condition) => condition.trim())
    .filter(Boolean);
  const closeTime = new Date(input.closeTime).toISOString();
  const closeTimeSeconds = Math.floor(Date.parse(closeTime) / 1000);

  const requestBody = {
    question: input.question.trim(),
    closeTime,
    resolutionSource: input.resolutionSource.trim(),
    invalidConditions,
    outcomes: ["YES", "NO"],
    creationBond: input.creationBond,
    initialLiquidity: input.initialLiquidity,
  };

  try {
    const response = await fetch(`${apiBaseUrl}/markets/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    if (response.ok) {
      return marketDraftResponseSchema.parse(await response.json());
    }
  } catch {
    // Local fallback keeps the form useful when the API is not running.
  }

  const draft = marketDraftSchema.parse({
    question: requestBody.question,
    closeTime,
    resolutionSource: requestBody.resolutionSource,
    invalidConditions,
    outcomes: ["YES", "NO"],
  });
  if (closeTimeSeconds <= Math.floor(Date.now() / 1000)) {
    throw new Error("closeTime must be in the future");
  }
  const specHashInput = {
    question: draft.question,
    outcomes: draft.outcomes,
    closeTime: draft.closeTime,
    resolutionSource: draft.resolutionSource,
    invalidConditions: draft.invalidConditions,
  };
  const specHash = keccak256(toHex(JSON.stringify(specHashInput)));

  return marketDraftResponseSchema.parse({
    draft,
    specHashInput,
    factoryArgs: {
      specHash,
      metadataURI: `local://drafts/${specHash.slice(2, 12)}`,
      closeTime: closeTimeSeconds,
      creationBond: parseUnits(input.creationBond || "0", 6).toString(),
      initialLiquidity: parseUnits(input.initialLiquidity || "0", 6).toString(),
    },
  });
}
