import {
  CREATE_MIN_CREATION_BOND_USDC,
  CREATE_MIN_INITIAL_LIQUIDITY_USDC,
  arcTestnet,
  deployedMarketSchema,
  localDeploymentSchema,
  marketDraftResponseSchema,
  marketDraftSchema,
  type DeployedMarket,
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
  encodePacked,
  formatUnits,
  http,
  keccak256,
  maxUint256,
  parseAbi,
  parseEventLogs,
  parseUnits,
  toHex,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  Address,
  ContractSurface,
  CreateDraftInput,
  DevActor,
  DevActorRole,
  EvidenceBriefReadModel,
  EvidenceInvalidCheckReadModel,
  EvidencePrepareInput,
  LpPositionReadback,
  MarketLifecycleReadback,
  MarketUserState,
  MarketReadModel,
  MarketSourceIdeaReadModel,
  PortfolioReadModel,
} from "./types";

const CREATE_MIN_CREATION_BOND_UNITS = parseUnits(CREATE_MIN_CREATION_BOND_USDC, 6);
const CREATE_MIN_INITIAL_LIQUIDITY_UNITS = parseUnits(CREATE_MIN_INITIAL_LIQUIDITY_USDC, 6);

type AbiEntry = { type?: string; name?: string };
export type ChainRuntimeMode = "local" | "arc-testnet";

export interface AppDeployment {
  schemaVersion: 1;
  generatedAtBlockTimestamp: number;
  chain: {
    id: number;
    name: string;
    rpcUrl: string;
  };
  contracts: {
    usdc: {
      address: Address;
      decimals: number;
    };
    outcomeToken: {
      address: Address;
    };
    iknowMarketFactory: {
      address: Address;
      defaultChallengeWindow?: number;
    };
  };
  actors?: Record<string, { address: Address; privateKey?: Hex } | Address>;
  markets: DeployedMarket[];
  mode: ChainRuntimeMode;
}

export interface ConnectedWalletRuntime {
  address?: Address;
  chainId?: number;
  walletClient?: WalletClient;
}

export const apiBaseUrl = import.meta.env.VITE_IKNOW_API_URL ?? "http://127.0.0.1:8787";
export const chainRuntimeMode: ChainRuntimeMode =
  import.meta.env.VITE_IKNOW_CHAIN_MODE === "local" ? "local" : "arc-testnet";

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

export async function loadAppDeployment(): Promise<AppDeployment | null> {
  if (chainRuntimeMode === "local") {
    const localDeployment = await loadLocalDeployment();
    return localDeployment ? normalizeLocalDeployment(localDeployment) : null;
  }

  const response = await fetch(`${apiBaseUrl}/testnet/deployment`);
  if (!response.ok) {
    return fallbackArcDeployment();
  }

  return normalizeArcDeployment(await response.json());
}

function normalizeLocalDeployment(deployment: LocalDeployment): AppDeployment {
  return {
    schemaVersion: deployment.schemaVersion,
    generatedAtBlockTimestamp: deployment.generatedAtBlockTimestamp,
    chain: deployment.chain,
    contracts: {
      usdc: {
        address: deployment.contracts.mockUSDC.address as Address,
        decimals: deployment.contracts.mockUSDC.decimals,
      },
      outcomeToken: {
        address: deployment.contracts.outcomeToken.address as Address,
      },
      iknowMarketFactory: {
        address: deployment.contracts.iknowMarketFactory.address as Address,
      },
    },
    actors: deployment.actors as AppDeployment["actors"],
    markets: deployment.markets,
    mode: "local",
  };
}

function normalizeArcDeployment(raw: unknown): AppDeployment | null {
  const candidate = raw as {
    schemaVersion?: number;
    generatedAtBlockTimestamp?: number;
    chain?: { id?: number; name?: string; rpcUrl?: string };
    contracts?: {
      usdc?: { address?: string; decimals?: number };
      outcomeToken?: { address?: string };
      iknowMarketFactory?: { address?: string; defaultChallengeWindow?: number };
    };
    actors?: Record<string, string>;
    markets?: unknown[];
  };
  const marketFactory = addressOrUndefined(candidate.contracts?.iknowMarketFactory?.address);
  const outcomeToken = addressOrUndefined(candidate.contracts?.outcomeToken?.address);
  const usdc = addressOrUndefined(candidate.contracts?.usdc?.address);

  if (!marketFactory || !outcomeToken || !usdc) {
    return fallbackArcDeployment();
  }

  return {
    schemaVersion: 1,
    generatedAtBlockTimestamp:
      typeof candidate.generatedAtBlockTimestamp === "number"
        ? candidate.generatedAtBlockTimestamp
        : Math.floor(Date.now() / 1000),
    chain: {
      id: candidate.chain?.id ?? arcTestnet.id,
      name: candidate.chain?.name ?? arcTestnet.name,
      rpcUrl: candidate.chain?.rpcUrl ?? arcTestnet.rpcUrl,
    },
    contracts: {
      usdc: {
        address: usdc,
        decimals: candidate.contracts?.usdc?.decimals ?? 6,
      },
      outcomeToken: {
        address: outcomeToken,
      },
      iknowMarketFactory: {
        address: marketFactory,
        defaultChallengeWindow: candidate.contracts?.iknowMarketFactory?.defaultChallengeWindow,
      },
    },
    actors: Object.fromEntries(
      Object.entries(candidate.actors ?? {}).flatMap(([id, address]) => {
        const normalized = addressOrUndefined(address);
        return normalized ? [[id, normalized]] : [];
      }),
    ),
    markets: (candidate.markets ?? []).flatMap((market) => {
      const parsed = deployedMarketSchema.safeParse(market);
      return parsed.success ? [parsed.data] : [];
    }),
    mode: "arc-testnet",
  };
}

function fallbackArcDeployment(): AppDeployment | null {
  const marketFactory = addressOrUndefined(deployedAddresses.arcTestnet.marketFactory);
  const outcomeToken = addressOrUndefined(deployedAddresses.arcTestnet.outcomeToken);
  if (!marketFactory || !outcomeToken) {
    return null;
  }

  return {
    schemaVersion: 1,
    generatedAtBlockTimestamp: Math.floor(Date.now() / 1000),
    chain: {
      id: arcTestnet.id,
      name: arcTestnet.name,
      rpcUrl: arcTestnet.rpcUrl,
    },
    contracts: {
      usdc: {
        address: "0x3600000000000000000000000000000000000000",
        decimals: 6,
      },
      outcomeToken: {
        address: outcomeToken,
      },
      iknowMarketFactory: {
        address: marketFactory,
      },
    },
    actors: {},
    markets: [],
    mode: "arc-testnet",
  };
}

export const contractSurface = (deployment: AppDeployment | null): ContractSurface => {
  if (deployment) {
    return {
      chainId: deployment.chain.id,
      chainName: deployment.chain.name,
      rpcUrl: deployment.chain.rpcUrl,
      explorerUrl: deployment.mode === "arc-testnet" ? arcTestnet.explorerUrl : "",
      marketFactory: deployment.contracts.iknowMarketFactory.address,
      outcomeToken: deployment.contracts.outcomeToken.address,
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

const actorLabels: Record<string, { name: string; role: DevActorRole; usdcBalance: string }> = {
  deployer: { name: "Deployer", role: "Deployer", usdcBalance: "MockUSDC minter" },
  creator: { name: "Creator", role: "Creator", usdcBalance: "100,000 seeded" },
  traderYes: { name: "TraderYes", role: "TraderYes", usdcBalance: "25,000 seeded" },
  traderNo: { name: "TraderNo", role: "TraderNo", usdcBalance: "25,000 seeded" },
  liquidityProvider: { name: "LiquidityProvider", role: "LiquidityProvider", usdcBalance: "100,000 seeded" },
  resolver: { name: "Resolver", role: "Resolver", usdcBalance: "Resolver only" },
  protocol: { name: "Protocol", role: "Protocol", usdcBalance: "Fee recipient" },
};

export function devActorsFromDeployment(deployment: AppDeployment | null, walletAddress?: Address): DevActor[] {
  if (!deployment) {
    return fallbackDevActors;
  }

  if (deployment.mode === "arc-testnet") {
    return [
      {
        id: "wallet",
        name: walletAddress ? "Wallet" : "Connect wallet",
        role: "Creator",
        address: walletAddress ?? "0x0000000000000000000000000000000000000000",
        usdcBalance: "Arc Testnet",
      },
    ];
  }

  return Object.entries(deployment.actors ?? {}).map(([id, actor]) => ({
    id,
    address: actorAddress(actor),
    ...(actorLabels[id] ?? { name: id, role: "Creator" as DevActorRole, usdcBalance: "Local actor" }),
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

export function marketsFromDeployment(deployment: AppDeployment | null): MarketReadModel[] {
  if (!deployment) {
    return fallbackMarkets;
  }

  return deployment.markets.map((market, index) => ({
    id: market.id || shortId(market.question),
    address: market.address as Address,
    question: market.question,
    status: index === 0 ? "Open" : "Open",
    closeTime: new Date(market.closeTime * 1000).toISOString(),
    resolutionSource: market.resolutionSource ?? "Local seed artifact; replace with market metadata in the next API pass.",
    invalidConditions: market.invalidConditions ?? ["Local demo market metadata is unavailable."],
    metadataURI: market.metadataURI,
    specHash: market.specHash as `0x${string}`,
    imageUrl: market.imageUrl,
    sourceIdea: market.sourceIdea,
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
  readMarkets: () => Promise<MarketReadModel[]>;
  buildDraftPreview: (input: CreateDraftInput) => Promise<MarketDraftResponse>;
  prepareEvidencePacket: (input: EvidencePrepareInput) => Promise<EvidenceBriefReadModel>;
  readEvidencePacket: (idOrUri: string) => Promise<EvidenceBriefReadModel>;
  buildTradeQuote: (
    marketId: string,
    action: TradeAction,
    amount: string,
    slippageBps: number,
  ) => Promise<TradeQuoteReadback>;
  executeCreateMarket: (
    actorId: string,
    draft: MarketDraftResponse,
    sourceMetadata?: CreateMarketSourceMetadata,
  ) => Promise<MarketCreationResult>;
  executeBuy: (
    actorId: string,
    marketId: string,
    side: "YES" | "NO",
    usdcAmount: string,
    slippageBps?: number,
  ) => Promise<Hex>;
  executeSell: (
    actorId: string,
    marketId: string,
    side: "YES" | "NO",
    outcomeAmount: string,
    slippageBps?: number,
  ) => Promise<Hex>;
  executeAddLiquidity: (actorId: string, marketId: string, usdcAmount: string) => Promise<Hex>;
  executeRemoveLiquidity: (actorId: string, marketId: string, lpShares: string) => Promise<Hex>;
  readMarketUserState: (actorId: string, marketId: string) => Promise<MarketUserState>;
  readMarketLifecycle: (actorId: string, marketId: string) => Promise<MarketLifecycleReadback>;
  readLpPosition: (actorId: string, marketId: string) => Promise<LpPositionReadback>;
  readLpPortfolio: (actorId: string) => Promise<PortfolioReadModel>;
  executeCloseMarket: (actorId: string, marketId: string) => Promise<Hex>;
  executeProposeResolution: (
    actorId: string,
    marketId: string,
    outcome: ResolutionOutcomeInput,
    evidenceURI: string,
  ) => Promise<Hex>;
  executeFinalizeResolution: (actorId: string, marketId: string) => Promise<Hex>;
  executeRedeem: (actorId: string, marketId: string) => Promise<Hex>;
  executeClaimCreatorFees: (actorId: string, marketId: string) => Promise<Hex>;
  executeClaimProtocolFees: (actorId: string, marketId: string) => Promise<Hex>;
  executeClaimCreationBond: (actorId: string, marketId: string) => Promise<Hex>;
  executeWarpToClose: (marketId: string) => Promise<Hex>;
  executeWarpChallengeWindow: (marketId: string) => Promise<Hex>;
}

export interface MarketCreationResult {
  hash: Hex;
  market: DeployedMarket;
}

export interface CreateMarketSourceMetadata {
  imageUrl?: string;
  sourceIdea?: MarketSourceIdeaReadModel;
}

export type TradeAction = "BUY_YES" | "BUY_NO" | "SELL_YES" | "SELL_NO";
export type ResolutionOutcomeInput = "YES" | "NO" | "INVALID";

export interface TradeQuoteReadback {
  action: TradeAction;
  inputLabel: string;
  outputLabel: string;
  feeLabel: string;
  minOutputLabel: string;
  amountOut: string;
  fee: string;
  minAmountOut: string;
  slippageBps: number;
}

export function createMarketDataSource(
  deployment: AppDeployment | null,
  actors: DevActor[],
  wallet?: ConnectedWalletRuntime,
): MarketDataSource {
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
            status: market.status,
            resolution: "Unresolved",
            yesShares: "0",
            noShares: "0",
            lpShares: "500 seeded",
            redeemable: "0 USDC",
            claimable: "LP fees pending",
          }))
        : actor.role === "TraderYes"
          ? markets.slice(0, 1).map((market) => ({
              marketId: market.id,
              marketQuestion: market.question,
              status: market.status,
              resolution: "Unresolved",
              yesShares: "Seeded buy",
              noShares: "0",
              lpShares: "0",
              redeemable: "Pending resolution",
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
    readMarkets: () => readMarkets(deployment),
    buildDraftPreview,
    prepareEvidencePacket,
    readEvidencePacket,
    buildTradeQuote: (marketId, action, amount, slippageBps) =>
      buildTradeQuote(deployment, marketId, action, amount, slippageBps),
    executeCreateMarket: (actorId, draft, sourceMetadata) =>
      executeCreateMarket(deployment, actorId, draft, sourceMetadata, wallet),
    executeBuy: (actorId, marketId, side, usdcAmount, slippageBps) =>
      executeBuy(deployment, actorId, marketId, side, usdcAmount, slippageBps, wallet),
    executeSell: (actorId, marketId, side, outcomeAmount, slippageBps) =>
      executeSell(deployment, actorId, marketId, side, outcomeAmount, slippageBps, wallet),
    executeAddLiquidity: (actorId, marketId, usdcAmount) =>
      executeAddLiquidity(deployment, actorId, marketId, usdcAmount, wallet),
    executeRemoveLiquidity: (actorId, marketId, lpShares) =>
      executeRemoveLiquidity(deployment, actorId, marketId, lpShares, wallet),
    readMarketUserState: (actorId, marketId) => readMarketUserState(deployment, actors, markets, actorId, marketId),
    readMarketLifecycle: (actorId, marketId) => readMarketLifecycle(deployment, actors, actorId, marketId),
    readLpPosition: (actorId, marketId) => readLpPosition(deployment, actors, markets, actorId, marketId),
    readLpPortfolio: (actorId) => readLpPortfolio(deployment, actors, markets, actorId),
    executeCloseMarket: (actorId, marketId) => executeCloseMarket(deployment, actorId, marketId, wallet),
    executeProposeResolution: (actorId, marketId, outcome, evidenceURI) =>
      executeProposeResolution(deployment, actorId, marketId, outcome, evidenceURI, wallet),
    executeFinalizeResolution: (actorId, marketId) => executeFinalizeResolution(deployment, actorId, marketId, wallet),
    executeRedeem: (actorId, marketId) => executeRedeem(deployment, actorId, marketId, wallet),
    executeClaimCreatorFees: (actorId, marketId) => executeClaimCreatorFees(deployment, actorId, marketId, wallet),
    executeClaimProtocolFees: (actorId, marketId) => executeClaimProtocolFees(deployment, actorId, marketId, wallet),
    executeClaimCreationBond: (actorId, marketId) => executeClaimCreationBond(deployment, actorId, marketId, wallet),
    executeWarpToClose: (marketId) => executeWarpToClose(deployment, marketId),
    executeWarpChallengeWindow: (marketId) => executeWarpChallengeWindow(deployment, marketId),
  };
}

const erc20Abi = parseAbi(["function approve(address spender,uint256 value) returns (bool)"]);
const outcomeApprovalAbi = parseAbi([
  "function isApprovedForAll(address account,address operator) view returns (bool)",
  "function setApprovalForAll(address operator,bool approved)",
]);

function requireDeployment(deployment: AppDeployment | null): AppDeployment {
  if (!deployment) {
    throw new Error(
      chainRuntimeMode === "arc-testnet"
        ? "Arc testnet deployment is not loaded. Run pnpm dev:api and check contracts/deployments/arc-testnet.json."
        : "Local deployment is not loaded. Run pnpm chain:anvil, pnpm chain:deploy, and pnpm dev:api.",
    );
  }

  return deployment;
}

function actorAddress(actor: { address: Address; privateKey?: Hex } | Address): Address {
  return typeof actor === "string" ? actor : actor.address;
}

function actorPrivateKey(actor: { address: Address; privateKey?: Hex } | Address): Hex | undefined {
  return typeof actor === "string" ? undefined : actor.privateKey;
}

function actorAccount(deployment: AppDeployment, actorId: string) {
  const actor = deployment.actors?.[actorId];
  const privateKey = actor ? actorPrivateKey(actor) : undefined;
  if (!privateKey) {
    throw new Error(`Unknown local actor: ${actorId}`);
  }

  return privateKeyToAccount(privateKey);
}

function chainForDeployment(deployment: AppDeployment) {
  return {
    id: deployment.chain.id,
    name: deployment.chain.name,
    nativeCurrency:
      deployment.mode === "arc-testnet" ? arcTestnet.nativeCurrency : { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [deployment.chain.rpcUrl] } },
  } as const;
}

function publicClientFor(deployment: AppDeployment) {
  return createPublicClient({ chain: chainForDeployment(deployment), transport: http(deployment.chain.rpcUrl) });
}

function localClients(deployment: AppDeployment, actorId: string) {
  if (deployment.mode !== "local") {
    throw new Error("Local dev actor signing is disabled on Arc Testnet. Connect a wallet to sign this transaction.");
  }
  const chain = chainForDeployment(deployment);
  const account = actorAccount(deployment, actorId);
  return {
    publicClient: publicClientFor(deployment),
    walletClient: createWalletClient({
      account,
      chain,
      transport: http(deployment.chain.rpcUrl),
    }),
    account,
  };
}

function connectedWriter(deployment: AppDeployment, actorId: string, wallet?: ConnectedWalletRuntime) {
  if (deployment.mode === "local") {
    const { walletClient, account } = localClients(deployment, actorId);
    return { walletClient, account };
  }

  if (!wallet?.address) {
    throw new Error("Connect your wallet before sending this Arc Testnet transaction.");
  }

  if (!wallet.walletClient) {
    throw new Error("Wallet is connected, but the signer is not ready yet. Wait a moment, then try again.");
  }

  if (wallet.chainId && wallet.chainId !== deployment.chain.id) {
    throw new Error(`Switch your wallet to ${deployment.chain.name} before sending this transaction.`);
  }

  return { walletClient: wallet.walletClient, account: wallet.address };
}

async function writeContractUnchecked(walletClient: WalletClient, parameters: Record<string, unknown>): Promise<Hex> {
  return (walletClient.writeContract as (request: unknown) => Promise<Hex>)(parameters);
}

function actorReadAddress(deployment: AppDeployment, actors: DevActor[], actorId: string): Address {
  const actor = actors.find((candidate) => candidate.id === actorId);
  if (actor) {
    return actor.address;
  }

  const deploymentActor = deployment.actors?.[actorId];
  if (deploymentActor) {
    return actorAddress(deploymentActor);
  }

  return "0x0000000000000000000000000000000000000000";
}

function actorIsResolver(deployment: AppDeployment, actor: DevActor | undefined, actorAddressValue: Address) {
  const resolver = deployment.actors?.resolver;
  return (
    actor?.role === "Resolver" ||
    Boolean(resolver && actorAddress(resolver).toLowerCase() === actorAddressValue.toLowerCase())
  );
}

function recipientFor(deployment: AppDeployment, actorId: string, wallet?: ConnectedWalletRuntime): Address {
  if (deployment.mode === "arc-testnet") {
    if (!wallet?.address) {
      throw new Error("Connect your wallet before claiming funds on Arc Testnet.");
    }
    return wallet.address;
  }

  return actorAccount(deployment, actorId).address;
}

async function waitForSuccess(deployment: AppDeployment, hash: Hex) {
  const receipt = await publicClientFor(deployment).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction failed: ${hash}`);
  }

  return receipt;
}

async function approveUsdc(
  deployment: AppDeployment,
  actorId: string,
  spender: Address,
  amount: bigint,
  wallet?: ConnectedWalletRuntime,
) {
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);
  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: deployment.contracts.usdc.address,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
  await waitForSuccess(deployment, hash);
}

async function approveOutcomeSpender(
  deployment: AppDeployment,
  actorId: string,
  spender: Address,
  wallet?: ConnectedWalletRuntime,
) {
  const publicClient = publicClientFor(deployment);
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);
  const owner = typeof account === "string" ? account : account.address;
  const approved = await publicClient.readContract({
    address: deployment.contracts.outcomeToken.address,
    abi: outcomeApprovalAbi,
    functionName: "isApprovedForAll",
    args: [owner, spender],
  });

  if (approved) {
    return;
  }

  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: deployment.contracts.outcomeToken.address,
    abi: outcomeApprovalAbi,
    functionName: "setApprovalForAll",
    args: [spender, true],
  });
  await waitForSuccess(deployment, hash);
}

function parseTradeAmount(deployment: AppDeployment, amount: string) {
  const parsed = parseUnits(amount || "0", deployment.contracts.usdc.decimals);
  if (parsed <= 0n) {
    throw new Error("Amount must be greater than zero");
  }

  return parsed;
}

function boundedSlippageBps(slippageBps = 100) {
  if (!Number.isFinite(slippageBps)) {
    return 100;
  }

  return Math.min(5_000, Math.max(0, Math.round(slippageBps)));
}

function minOutForSlippage(amountOut: bigint, slippageBps?: number) {
  return (amountOut * BigInt(10_000 - boundedSlippageBps(slippageBps))) / 10_000n;
}

function tokenAmountLabel(deployment: AppDeployment, amount: bigint, symbol: string) {
  return `${displayUnits(amount, deployment.contracts.usdc.decimals)} ${symbol}`;
}

function priceFromReserves(yesReserve: bigint, noReserve: bigint) {
  const total = yesReserve + noReserve;
  if (total === 0n) {
    return { yesPrice: 0.5, noPrice: 0.5 };
  }

  const yesPrice = Number(noReserve) / Number(total);
  return { yesPrice, noPrice: 1 - yesPrice };
}

async function readMarkets(maybeDeployment: AppDeployment | null): Promise<MarketReadModel[]> {
  const deployment = requireDeployment(maybeDeployment);
  const publicClient = publicClientFor(deployment);
  const decimals = deployment.contracts.usdc.decimals;

  return Promise.all(
    deployment.markets.map(async (market) => {
      const marketAddress = market.address as Address;
      const [reserves, totalLpShares, state] = await Promise.all([
        publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "reserves" }),
        publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "totalLpShares" }),
        publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "state" }),
      ]);
      const [yesReserve, noReserve] = reserves;
      const { yesPrice, noPrice } = priceFromReserves(yesReserve, noReserve);

      return {
        id: market.id || shortId(market.question),
        address: market.address as Address,
        question: market.question,
        status: marketStatusFromState(Number(state)),
        closeTime: new Date(market.closeTime * 1000).toISOString(),
        resolutionSource: market.resolutionSource ?? "Local seed artifact; replace with market metadata in the next API pass.",
        invalidConditions: market.invalidConditions ?? ["Local demo market metadata is unavailable."],
        metadataURI: market.metadataURI,
        specHash: market.specHash as `0x${string}`,
        imageUrl: market.imageUrl,
        sourceIdea: market.sourceIdea,
        creator: "Creator",
        yesPrice,
        noPrice,
        liquidity: `${displayUnits(totalLpShares, decimals)} LP`,
        yesReserve: `${displayUnits(yesReserve, decimals)} YES`,
        noReserve: `${displayUnits(noReserve, decimals)} NO`,
        volume24h: "Local live",
      };
    }),
  );
}

async function quoteTrade(
  deployment: AppDeployment,
  marketId: string,
  action: TradeAction,
  amount: bigint,
  slippageBps = 100,
) {
  const market = findMarket(deployment, marketId);
  const publicClient = publicClientFor(deployment);
  const marketAddress = market.address as Address;
  const [amountOut, fee] =
    action === "BUY_YES"
      ? await publicClient.readContract({
          address: marketAddress,
          abi: iknowMarketAbi,
          functionName: "quoteBuyYes",
          args: [amount],
        })
      : action === "BUY_NO"
        ? await publicClient.readContract({
            address: marketAddress,
            abi: iknowMarketAbi,
            functionName: "quoteBuyNo",
            args: [amount],
          })
        : action === "SELL_YES"
          ? await publicClient.readContract({
              address: marketAddress,
              abi: iknowMarketAbi,
              functionName: "quoteSellYes",
              args: [amount],
            })
          : await publicClient.readContract({
              address: marketAddress,
              abi: iknowMarketAbi,
              functionName: "quoteSellNo",
              args: [amount],
            });

  return {
    amountOut,
    fee,
    minAmountOut: minOutForSlippage(amountOut, slippageBps),
    slippageBps: boundedSlippageBps(slippageBps),
  };
}

async function buildTradeQuote(
  maybeDeployment: AppDeployment | null,
  marketId: string,
  action: TradeAction,
  rawAmount: string,
  slippageBps: number,
): Promise<TradeQuoteReadback> {
  const deployment = requireDeployment(maybeDeployment);
  const amount = parseTradeAmount(deployment, rawAmount);
  const quote = await quoteTrade(deployment, marketId, action, amount, slippageBps);
  const isBuy = action === "BUY_YES" || action === "BUY_NO";
  const side = action.endsWith("YES") ? "YES" : "NO";

  return {
    action,
    inputLabel: isBuy ? tokenAmountLabel(deployment, amount, "USDC") : tokenAmountLabel(deployment, amount, side),
    outputLabel: isBuy
      ? tokenAmountLabel(deployment, quote.amountOut, side)
      : tokenAmountLabel(deployment, quote.amountOut, "USDC"),
    feeLabel: tokenAmountLabel(deployment, quote.fee, "USDC"),
    minOutputLabel: isBuy
      ? tokenAmountLabel(deployment, quote.minAmountOut, side)
      : tokenAmountLabel(deployment, quote.minAmountOut, "USDC"),
    amountOut: quote.amountOut.toString(),
    fee: quote.fee.toString(),
    minAmountOut: quote.minAmountOut.toString(),
    slippageBps: quote.slippageBps,
  };
}

function displayUnits(value: bigint, decimals: number) {
  const formatted = formatUnits(value, decimals);
  if (!formatted.includes(".")) {
    return Number(formatted).toLocaleString();
  }

  const [whole, fraction] = formatted.split(".");
  const trimmedFraction = fraction.replace(/0+$/g, "");
  const localizedWhole = Number(whole).toLocaleString();

  return trimmedFraction ? `${localizedWhole}.${trimmedFraction}` : localizedWhole;
}

function findMarket(deployment: AppDeployment, marketId: string) {
  const market = deployment.markets.find((candidate) => candidate.id === marketId);
  if (!market) {
    throw new Error(`Unknown market: ${marketId}`);
  }

  return market;
}

const stateLabels = ["Open", "Closed", "Resolution proposed", "Resolved"] as const;
const outcomeLabels = ["Unresolved", "YES", "NO", "INVALID"] as const;

function marketStatusFromState(state: number): MarketReadModel["status"] {
  return stateLabels[state] ?? "Open";
}

function outcomeLabel(outcome: number) {
  return outcomeLabels[outcome] ?? "Unknown";
}

function outcomeArg(outcome: ResolutionOutcomeInput) {
  if (outcome === "YES") {
    return 1;
  }
  if (outcome === "NO") {
    return 2;
  }
  return 3;
}

function redeemableForOutcome(finalOutcome: number, yesBalance: bigint, noBalance: bigint) {
  if (finalOutcome === 1) {
    return yesBalance;
  }
  if (finalOutcome === 2) {
    return noBalance;
  }
  if (finalOutcome === 3) {
    return yesBalance < noBalance ? yesBalance : noBalance;
  }
  return 0n;
}

async function readLpPosition(
  maybeDeployment: AppDeployment | null,
  actors: DevActor[],
  markets: MarketReadModel[],
  actorId: string,
  marketId: string,
): Promise<LpPositionReadback> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const readModel = markets.find((candidate) => candidate.id === marketId);
  const actorAddress = actorReadAddress(deployment, actors, actorId);
  const marketAddress = market.address as Address;
  const decimals = deployment.contracts.usdc.decimals;
  const publicClient = publicClientFor(deployment);

  const [shares, pending, totalShares, accLpFeePerShare, lpFeeDebt, lpFeePrecision] = await Promise.all([
    publicClient.readContract({
      address: marketAddress,
      abi: iknowMarketAbi,
      functionName: "lpShares",
      args: [actorAddress],
    }),
    publicClient.readContract({
      address: marketAddress,
      abi: iknowMarketAbi,
      functionName: "pendingLpFees",
      args: [actorAddress],
    }),
    publicClient.readContract({
      address: marketAddress,
      abi: iknowMarketAbi,
      functionName: "totalLpShares",
    }),
    publicClient.readContract({
      address: marketAddress,
      abi: iknowMarketAbi,
      functionName: "accLpFeePerShare",
    }),
    publicClient.readContract({
      address: marketAddress,
      abi: iknowMarketAbi,
      functionName: "lpFeeDebt",
      args: [actorAddress],
    }),
    publicClient.readContract({
      address: marketAddress,
      abi: iknowMarketAbi,
      functionName: "LP_FEE_ACC_PRECISION",
    }),
  ]);
  const accrued = (shares * accLpFeePerShare) / lpFeePrecision;
  const checkpointable = accrued > lpFeeDebt ? accrued - lpFeeDebt : 0n;
  const pendingFees = pending + checkpointable;

  return {
    marketId,
    marketQuestion: readModel?.question ?? market.question,
    lpShares: `${displayUnits(shares, decimals)} LP`,
    pendingFees: `${displayUnits(pendingFees, decimals)} USDC`,
    totalLpShares: `${displayUnits(totalShares, decimals)} LP`,
    lpSharesRaw: shares.toString(),
    pendingFeesRaw: pendingFees.toString(),
  };
}

async function readMarketLifecycle(
  maybeDeployment: AppDeployment | null,
  actors: DevActor[],
  actorId: string,
  marketId: string,
): Promise<MarketLifecycleReadback> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const actor = actors.find((candidate) => candidate.id === actorId);
  const actorAddressValue = actorReadAddress(deployment, actors, actorId);
  const marketAddress = market.address as Address;
  const decimals = deployment.contracts.usdc.decimals;
  const publicClient = publicClientFor(deployment);

  const [
    state,
    proposedOutcome,
    finalOutcome,
    finalizeAfter,
    evidenceURI,
    closeTime,
    creator,
    protocolFeeRecipient,
    creatorFeePool,
    protocolFeePool,
    creationBond,
    yesBalance,
    noBalance,
    latestBlock,
  ] = await Promise.all([
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "state" }),
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "proposedOutcome" }),
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "finalOutcome" }),
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "finalizeAfter" }),
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "evidenceURI" }),
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "closeTime" }),
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "creator" }),
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "protocolFeeRecipient" }),
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "creatorFeePool" }),
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "protocolFeePool" }),
    publicClient.readContract({ address: marketAddress, abi: iknowMarketAbi, functionName: "creationBond" }),
    publicClient.readContract({
      address: deployment.contracts.outcomeToken.address as Address,
      abi: outcomeTokenAbi,
      functionName: "balanceOf",
      args: [actorAddressValue, BigInt(market.yesTokenId)],
    }),
    publicClient.readContract({
      address: deployment.contracts.outcomeToken.address as Address,
      abi: outcomeTokenAbi,
      functionName: "balanceOf",
      args: [actorAddressValue, BigInt(market.noTokenId)],
    }),
    publicClient.getBlock(),
  ]);
  const stateNumber = Number(state);
  const finalOutcomeNumber = Number(finalOutcome);
  const proposedOutcomeNumber = Number(proposedOutcome);
  const now = latestBlock.timestamp;
  const redeemable = stateNumber === 3 ? redeemableForOutcome(finalOutcomeNumber, yesBalance, noBalance) : 0n;
  const isCreator = actorAddressValue.toLowerCase() === creator.toLowerCase();
  const isProtocolRecipient = actorAddressValue.toLowerCase() === protocolFeeRecipient.toLowerCase();
  const isResolver = actorIsResolver(deployment, actor, actorAddressValue);
  const resolvedNonInvalid = stateNumber === 3 && finalOutcomeNumber !== 3;

  return {
    state: marketStatusFromState(stateNumber),
    proposedOutcome: outcomeLabel(proposedOutcomeNumber),
    finalOutcome: outcomeLabel(finalOutcomeNumber),
    closeTime: new Date(Number(closeTime) * 1000).toISOString(),
    finalizeAfter: finalizeAfter === 0n ? "" : new Date(Number(finalizeAfter) * 1000).toISOString(),
    evidenceURI,
    redeemable: `${displayUnits(redeemable, decimals)} USDC`,
    creatorFees: `${displayUnits(creatorFeePool, decimals)} USDC`,
    protocolFees: `${displayUnits(protocolFeePool, decimals)} USDC`,
    creationBond: `${displayUnits(creationBond, decimals)} USDC`,
    redeemableRaw: redeemable.toString(),
    creatorFeesRaw: creatorFeePool.toString(),
    protocolFeesRaw: protocolFeePool.toString(),
    creationBondRaw: creationBond.toString(),
    canClose: stateNumber === 0 && now >= closeTime,
    canPropose: isResolver && (stateNumber === 1 || (stateNumber === 0 && now >= closeTime)),
    canFinalize: stateNumber === 2 && now >= finalizeAfter,
    canRedeem: redeemable > 0n,
    canClaimCreatorFees: isCreator && resolvedNonInvalid && creatorFeePool > 0n,
    canClaimProtocolFees: isProtocolRecipient && protocolFeePool > 0n,
    canClaimCreationBond: isCreator && resolvedNonInvalid && creationBond > 0n,
  };
}

async function readMarketUserState(
  maybeDeployment: AppDeployment | null,
  actors: DevActor[],
  markets: MarketReadModel[],
  actorId: string,
  marketId: string,
): Promise<MarketUserState> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const actorAddressValue = actorReadAddress(deployment, actors, actorId);
  const marketAddress = market.address as Address;
  const decimals = deployment.contracts.usdc.decimals;
  const publicClient = publicClientFor(deployment);

  const [reserves, yesBalance, noBalance, lpPosition] = await Promise.all([
    publicClient.readContract({
      address: marketAddress,
      abi: iknowMarketAbi,
      functionName: "reserves",
    }),
    publicClient.readContract({
      address: deployment.contracts.outcomeToken.address,
      abi: outcomeTokenAbi,
      functionName: "balanceOf",
      args: [actorAddressValue, BigInt(market.yesTokenId)],
    }),
    publicClient.readContract({
      address: deployment.contracts.outcomeToken.address,
      abi: outcomeTokenAbi,
      functionName: "balanceOf",
      args: [actorAddressValue, BigInt(market.noTokenId)],
    }),
    readLpPosition(maybeDeployment, actors, markets, actorId, marketId),
  ]);
  const [yesReserve, noReserve] = reserves;

  return {
    yesReserve: `${displayUnits(yesReserve, decimals)} YES`,
    noReserve: `${displayUnits(noReserve, decimals)} NO`,
    yesBalance: `${displayUnits(yesBalance, decimals)} YES`,
    noBalance: `${displayUnits(noBalance, decimals)} NO`,
    lpShares: lpPosition.lpShares,
    pendingLpFees: lpPosition.pendingFees,
    totalLpShares: lpPosition.totalLpShares,
    yesBalanceRaw: yesBalance.toString(),
    noBalanceRaw: noBalance.toString(),
    lpSharesRaw: lpPosition.lpSharesRaw,
    pendingLpFeesRaw: lpPosition.pendingFeesRaw,
  };
}

async function readLpPortfolio(
  maybeDeployment: AppDeployment | null,
  actors: DevActor[],
  markets: MarketReadModel[],
  actorId: string,
): Promise<PortfolioReadModel> {
  const deployment = requireDeployment(maybeDeployment);
  const actor = actors.find((candidate) => candidate.id === actorId) ?? actors[0];
  const readbacks = await Promise.all(
    markets.map(async (market) => {
      const [userState, lifecycle] = await Promise.all([
        readMarketUserState(deployment, actors, markets, actorId, market.id),
        readMarketLifecycle(deployment, actors, actorId, market.id),
      ]);
      const claimableRaw =
        BigInt(userState.pendingLpFeesRaw) +
        (lifecycle.canRedeem ? BigInt(lifecycle.redeemableRaw) : 0n) +
        (lifecycle.canClaimCreatorFees ? BigInt(lifecycle.creatorFeesRaw) : 0n) +
        (lifecycle.canClaimProtocolFees ? BigInt(lifecycle.protocolFeesRaw) : 0n) +
        (lifecycle.canClaimCreationBond ? BigInt(lifecycle.creationBondRaw) : 0n);

      return {
        market,
        lifecycle,
        userState,
        claimableRaw,
      };
    }),
  );
  const activeReadbacks = readbacks.filter(
    ({ userState, claimableRaw }) =>
      BigInt(userState.yesBalanceRaw) > 0n ||
      BigInt(userState.noBalanceRaw) > 0n ||
      BigInt(userState.lpSharesRaw) > 0n ||
      claimableRaw > 0n,
  );
  const positions = activeReadbacks.map(({ market, lifecycle, userState, claimableRaw }) => ({
    marketId: market.id,
    marketQuestion: market.question,
    status: lifecycle.state,
    resolution: lifecycle.finalOutcome === "Unresolved" ? lifecycle.proposedOutcome : lifecycle.finalOutcome,
    yesShares: userState.yesBalance,
    noShares: userState.noBalance,
    lpShares: userState.lpShares,
    redeemable: lifecycle.redeemable,
    claimable: `${displayUnits(claimableRaw, deployment.contracts.usdc.decimals)} USDC`,
  }));
  const claimable = activeReadbacks.reduce((total, position) => total + position.claimableRaw, 0n);

  return {
    actor,
    positions,
    totals: {
      yesMarkets: positions.filter((position) => position.yesShares !== "0").length,
      noMarkets: positions.filter((position) => position.noShares !== "0").length,
      lpMarkets: positions.filter((position) => position.lpShares !== "0 LP").length,
      claimable: `${displayUnits(claimable, deployment.contracts.usdc.decimals)} USDC`,
    },
  };
}

async function executeCreateMarket(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  draft: MarketDraftResponse,
  sourceMetadata: CreateMarketSourceMetadata = {},
  wallet?: ConnectedWalletRuntime,
): Promise<MarketCreationResult> {
  const deployment = requireDeployment(maybeDeployment);
  const factory = deployment.contracts.iknowMarketFactory.address;
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);
  const totalUsdc = BigInt(draft.factoryArgs.creationBond) + BigInt(draft.factoryArgs.initialLiquidity);

  await approveUsdc(deployment, actorId, factory, totalUsdc, wallet);

  const hash = await writeContractUnchecked(walletClient, {
    account,
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
  const receipt = await waitForSuccess(deployment, hash);
  const logs = parseEventLogs({
    abi: iknowMarketFactoryAbi,
    logs: receipt.logs,
    eventName: "MarketCreated",
  });
  const marketAddress = logs[0]?.args.market;
  if (!marketAddress) {
    throw new Error("MarketCreated event missing from createMarket receipt");
  }
  const id = `${shortId(draft.draft.question)}-${hash.slice(2, 8)}`;
  const market: DeployedMarket = {
    id,
    address: marketAddress,
    specHash: draft.factoryArgs.specHash,
    metadataURI: draft.factoryArgs.metadataURI,
    question: draft.draft.question,
    closeTime: draft.factoryArgs.closeTime,
    resolutionSource: draft.draft.resolutionSource,
    invalidConditions: draft.draft.invalidConditions,
    imageUrl: sourceMetadata.imageUrl,
    sourceIdea: sourceMetadata.sourceIdea,
    creationBond: draft.factoryArgs.creationBond,
    initialLiquidity: draft.factoryArgs.initialLiquidity,
    yesTokenId: BigInt(keccak256(encodePacked(["address", "uint8"], [marketAddress, 0]))).toString(),
    noTokenId: BigInt(keccak256(encodePacked(["address", "uint8"], [marketAddress, 1]))).toString(),
  };

  await persistCreatedMarket(deployment, market);

  return {
    hash,
    market,
  };
}

async function persistCreatedMarket(deployment: AppDeployment, market: DeployedMarket) {
  try {
    const scope = deployment.mode === "arc-testnet" ? "testnet" : "local";
    await fetch(`${apiBaseUrl}/${scope}/deployment/markets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ market }),
    });
  } catch {
    // Transaction success is the source of truth; local artifact persistence is a convenience for dev readback.
  }
}

async function executeBuy(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  side: "YES" | "NO",
  usdcAmount: string,
  slippageBps = 100,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const amount = parseTradeAmount(deployment, usdcAmount);
  const quote = await quoteTrade(deployment, marketId, side === "YES" ? "BUY_YES" : "BUY_NO", amount, slippageBps);
  const marketAddress = market.address as Address;
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);

  await approveUsdc(deployment, actorId, marketAddress, amount, wallet);

  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: side === "YES" ? "buyYes" : "buyNo",
    args: [amount, quote.minAmountOut],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeSell(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  side: "YES" | "NO",
  outcomeAmount: string,
  slippageBps = 100,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const amount = parseTradeAmount(deployment, outcomeAmount);
  const quote = await quoteTrade(deployment, marketId, side === "YES" ? "SELL_YES" : "SELL_NO", amount, slippageBps);
  const marketAddress = market.address as Address;
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);

  await approveOutcomeSpender(deployment, actorId, marketAddress, wallet);

  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: side === "YES" ? "sellYes" : "sellNo",
    args: [amount, quote.minAmountOut],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeAddLiquidity(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  usdcAmount: string,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const amount = parseTradeAmount(deployment, usdcAmount);
  const marketAddress = market.address as Address;
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);

  await approveUsdc(deployment, actorId, marketAddress, maxUint256, wallet);

  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "addLiquidity",
    args: [amount, 0n],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeRemoveLiquidity(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  lpShares: string,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const shares = parseUnits(lpShares || "0", deployment.contracts.usdc.decimals);
  if (shares <= 0n) {
    throw new Error("LP shares must be greater than zero");
  }
  const marketAddress = market.address as Address;
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);

  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "removeLiquidity",
    args: [shares, 0n, 0n],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeCloseMarket(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);
  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "close",
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeProposeResolution(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  outcome: ResolutionOutcomeInput,
  evidenceURI: string,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);
  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "proposeResolution",
    args: [outcomeArg(outcome), evidenceURI || "local://evidence/manual-resolution"],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeFinalizeResolution(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);
  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "finalizeResolution",
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeRedeem(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);
  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "redeem",
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeClaimCreatorFees(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const marketAddress = market.address as Address;
  const publicClient = publicClientFor(deployment);
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);
  const recipient = recipientFor(deployment, actorId, wallet);
  const amount = await publicClient.readContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "creatorFeePool",
  });
  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "claimCreatorFees",
    args: [recipient, amount],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeClaimProtocolFees(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const marketAddress = market.address as Address;
  const publicClient = publicClientFor(deployment);
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);
  const recipient = recipientFor(deployment, actorId, wallet);
  const amount = await publicClient.readContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "protocolFeePool",
  });
  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "claimProtocolFees",
    args: [recipient, amount],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeClaimCreationBond(
  maybeDeployment: AppDeployment | null,
  actorId: string,
  marketId: string,
  wallet?: ConnectedWalletRuntime,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { walletClient, account } = connectedWriter(deployment, actorId, wallet);
  const recipient = recipientFor(deployment, actorId, wallet);
  const hash = await writeContractUnchecked(walletClient, {
    account,
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "claimCreationBond",
    args: [recipient],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function rpcRequest(deployment: AppDeployment, method: string, params: unknown[] = []) {
  if (deployment.mode !== "local") {
    throw new Error("Time warp is only available on local Anvil.");
  }

  const response = await fetch(deployment.chain.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const result = await response.json() as { error?: { message?: string }; result?: unknown };
  if (result.error) {
    throw new Error(result.error.message ?? `${method} failed`);
  }

  return result.result;
}

async function mineAtOrAfter(deployment: AppDeployment, timestamp: bigint) {
  const block = await publicClientFor(deployment).getBlock();
  if (block.timestamp < timestamp) {
    await rpcRequest(deployment, "evm_setNextBlockTimestamp", [Number(timestamp)]);
  }
  await rpcRequest(deployment, "evm_mine");
}

async function executeWarpToClose(maybeDeployment: AppDeployment | null, marketId: string): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  if (deployment.mode !== "local") {
    throw new Error("Time warp is only available on local Anvil.");
  }
  const market = findMarket(deployment, marketId);
  const closeTime = await publicClientFor(deployment).readContract({
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "closeTime",
  });

  await mineAtOrAfter(deployment, closeTime + 1n);
  return "0x0000000000000000000000000000000000000000000000000000000000000000";
}

async function executeWarpChallengeWindow(maybeDeployment: AppDeployment | null, marketId: string): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  if (deployment.mode !== "local") {
    throw new Error("Time warp is only available on local Anvil.");
  }
  const market = findMarket(deployment, marketId);
  const finalizeAfter = await publicClientFor(deployment).readContract({
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "finalizeAfter",
  });
  if (finalizeAfter === 0n) {
    throw new Error("No active challenge window");
  }

  await mineAtOrAfter(deployment, finalizeAfter + 1n);
  return "0x0000000000000000000000000000000000000000000000000000000000000000";
}

async function prepareEvidencePacket(input: EvidencePrepareInput): Promise<EvidenceBriefReadModel> {
  const response = await fetch(`${apiBaseUrl}/evidence/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      actorId: input.actorId,
      marketId: input.market.id,
      marketAddress: input.market.address,
      question: input.market.question,
      closeTime: input.market.closeTime,
      resolutionSource: input.market.resolutionSource,
      invalidConditions: input.market.invalidConditions,
      metadataURI: input.market.metadataURI,
      specHash: input.market.specHash,
    }),
  });
  const payload = await readJsonResponse(response, "Prepare evidence packet failed");
  const packet = evidencePacketPayload(payload);
  const brief = normalizeEvidenceBrief(packet, input.market.id);

  if (isEvidencePointerOnly(brief, packet)) {
    return readEvidencePacket(brief.id || brief.evidenceURI);
  }

  return brief;
}

async function readEvidencePacket(idOrUri: string): Promise<EvidenceBriefReadModel> {
  const lookupId = evidenceLookupId(idOrUri);
  const response = await fetch(`${apiBaseUrl}/evidence/${encodeURIComponent(lookupId)}`);
  const payload = await readJsonResponse(response, "Fetch evidence packet failed");

  return normalizeEvidenceBrief(evidencePacketPayload(payload), lookupId);
}

async function readJsonResponse(response: Response, fallbackMessage: string) {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const payloadRecord = asRecord(payload);
    const message =
      stringValue(payloadRecord, "message") ?? stringValue(payloadRecord, "error") ?? `${fallbackMessage}: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function evidencePacketPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  return record?.packet ?? record?.evidence ?? record?.brief ?? record?.result ?? payload;
}

function isEvidencePointerOnly(brief: EvidenceBriefReadModel, packet: unknown) {
  const record = asRecord(packet);
  return Boolean(
    record &&
      (record.id || record.evidenceId || record.packetId || record.evidenceURI || record.evidenceUri || record.uri) &&
      brief.suggestedOutcome === "UNKNOWN" &&
      brief.facts.length === 0 &&
      brief.evidenceLinks.length === 0 &&
      brief.invalidChecks.length === 0,
  );
}

function normalizeEvidenceBrief(packet: unknown, fallbackId: string): EvidenceBriefReadModel {
  const record = asRecord(packet) ?? {};
  const recommendation = asRecord(record.recommendation);
  const resolution = asRecord(record.resolution);
  const policy = asRecord(record.policy);
  const id =
    (stringValue(record, "id") ??
      stringValue(record, "evidenceId") ??
      stringValue(record, "packetId") ??
      evidenceLookupId(stringValue(record, "evidenceURI") ?? stringValue(record, "evidenceUri") ?? "")) ||
    fallbackId;

  return {
    id,
    evidenceURI:
      stringValue(record, "evidenceURI") ??
      stringValue(record, "evidenceUri") ??
      stringValue(record, "uri") ??
      `local://evidence/${id}`,
    suggestedOutcome: normalizeEvidenceOutcome(
      stringValue(record, "suggestedOutcome") ??
        stringValue(record, "outcome") ??
        stringValue(recommendation, "outcome") ??
        stringValue(resolution, "outcome"),
    ),
    confidence: normalizeConfidence(numberValue(record, "confidence") ?? numberValue(recommendation, "confidence")),
    facts: normalizeEvidenceFacts(record.facts ?? record.keyFacts ?? record.findings),
    evidenceLinks: normalizeEvidenceLinks(record.evidenceLinks ?? record.links ?? record.sources ?? record.citations),
    invalidChecks: normalizeInvalidChecks(record.invalidChecks ?? record.invalidConditions ?? record.checks),
    generatedAt:
      stringValue(record, "generatedAt") ??
      stringValue(record, "createdAt") ??
      stringValue(record, "timestamp") ??
      new Date().toISOString(),
    agentId:
      stringValue(record, "agentId") ??
      stringValue(record, "agent") ??
      stringValue(asRecord(record.agent), "id") ??
      "Unknown",
    policyStatus:
      stringValue(record, "policyStatus") ??
      stringValue(policy, "status") ??
      stringValue(record, "status") ??
      "Unavailable",
  };
}

function evidenceLookupId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const segments = withoutQuery.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? trimmed;
}

function normalizeEvidenceOutcome(value: string | undefined): EvidenceBriefReadModel["suggestedOutcome"] {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "YES" || normalized === "NO" || normalized === "INVALID") {
    return normalized;
  }

  return "UNKNOWN";
}

function normalizeConfidence(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return value > 1 && value <= 100 ? value / 100 : value;
}

function normalizeEvidenceFacts(value: unknown) {
  const entries = Array.isArray(value) ? value : [];
  return entries.flatMap((entry, index) => {
    if (typeof entry === "string") {
      return [{ label: `Fact ${index + 1}`, value: entry }];
    }
    const record = asRecord(entry);
    if (!record) {
      return [];
    }
    const factValue =
      stringValue(record, "value") ??
      stringValue(record, "text") ??
      stringValue(record, "summary") ??
      stringValue(record, "fact") ??
      stringValue(record, "claim");
    if (!factValue) {
      return [];
    }

    return [
      {
        label: stringValue(record, "label") ?? stringValue(record, "name") ?? stringValue(record, "title") ?? `Fact ${index + 1}`,
        value: factValue,
      },
    ];
  });
}

function normalizeEvidenceLinks(value: unknown) {
  const entries = Array.isArray(value) ? value : [];
  return entries.flatMap((entry, index) => {
    if (typeof entry === "string") {
      return [{ label: `Evidence ${index + 1}`, url: entry }];
    }
    const record = asRecord(entry);
    if (!record) {
      return [];
    }
    const url = stringValue(record, "url") ?? stringValue(record, "uri") ?? stringValue(record, "href") ?? stringValue(record, "sourceUrl");
    if (!url) {
      return [];
    }

    return [
      {
        label:
          stringValue(record, "label") ??
          stringValue(record, "title") ??
          stringValue(record, "name") ??
          `Evidence ${index + 1}`,
        url,
        source: stringValue(record, "source") ?? stringValue(record, "publisher"),
      },
    ];
  });
}

function normalizeInvalidChecks(value: unknown) {
  const entries = Array.isArray(value) ? value : [];
  return entries.flatMap((entry, index): EvidenceInvalidCheckReadModel[] => {
    if (typeof entry === "string") {
      return [{ label: entry, status: "unknown" }];
    }
    const record = asRecord(entry);
    if (!record) {
      return [];
    }

    return [
      {
        label:
          stringValue(record, "label") ??
          stringValue(record, "condition") ??
          stringValue(record, "name") ??
          `Invalid check ${index + 1}`,
        status: normalizeInvalidCheckStatus(record),
        note:
          stringValue(record, "note") ??
          stringValue(record, "reason") ??
          stringValue(record, "message") ??
          stringValue(record, "explanation"),
      },
    ];
  });
}

function normalizeInvalidCheckStatus(record: Record<string, unknown>): EvidenceInvalidCheckReadModel["status"] {
  const status = stringValue(record, "status")?.toLowerCase();
  if (status === "pass" || status === "passed" || status === "valid" || status === "clear") {
    return "pass";
  }
  if (status === "fail" || status === "failed" || status === "invalid" || status === "triggered") {
    return "fail";
  }
  if (typeof record.passed === "boolean") {
    return record.passed ? "pass" : "fail";
  }
  if (typeof record.isInvalid === "boolean") {
    return record.isInvalid ? "fail" : "pass";
  }

  return "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function stringValue(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function numberValue(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
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
      creationBond: parseCreateUsdcUnits(
        input.creationBond,
        CREATE_MIN_CREATION_BOND_USDC,
        CREATE_MIN_CREATION_BOND_UNITS,
        "Safety deposit",
      ).toString(),
      initialLiquidity: parseCreateUsdcUnits(
        input.initialLiquidity,
        CREATE_MIN_INITIAL_LIQUIDITY_USDC,
        CREATE_MIN_INITIAL_LIQUIDITY_UNITS,
        "Money to start the market",
      ).toString(),
    },
  });
}

function parseCreateUsdcUnits(value: string, fallback: string, minimum: bigint, label: string) {
  const text = (value || fallback).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    throw new Error("USDC amounts must be positive numbers with at most 6 decimal places");
  }

  const parsed = parseUnits(text, 6);
  if (parsed < minimum) {
    throw new Error(`${label} must be at least ${formatUnits(minimum, 6)} USDC`);
  }

  return parsed;
}
