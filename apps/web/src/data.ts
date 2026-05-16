import {
  arcTestnet,
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  Address,
  ContractSurface,
  CreateDraftInput,
  DevActor,
  DevActorRole,
  LpPositionReadback,
  MarketLifecycleReadback,
  MarketUserState,
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
    resolutionSource: market.resolutionSource ?? "Local seed artifact; replace with market metadata in the next API pass.",
    invalidConditions: market.invalidConditions ?? ["Local demo market metadata is unavailable."],
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
  readMarkets: () => Promise<MarketReadModel[]>;
  buildDraftPreview: (input: CreateDraftInput) => Promise<MarketDraftResponse>;
  buildTradeQuote: (
    marketId: string,
    action: TradeAction,
    amount: string,
    slippageBps: number,
  ) => Promise<TradeQuoteReadback>;
  executeCreateMarket: (actorId: string, draft: MarketDraftResponse) => Promise<MarketCreationResult>;
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
    buildTradeQuote: (marketId, action, amount, slippageBps) =>
      buildTradeQuote(deployment, marketId, action, amount, slippageBps),
    executeCreateMarket: (actorId, draft) => executeCreateMarket(deployment, actorId, draft),
    executeBuy: (actorId, marketId, side, usdcAmount, slippageBps) =>
      executeBuy(deployment, actorId, marketId, side, usdcAmount, slippageBps),
    executeSell: (actorId, marketId, side, outcomeAmount, slippageBps) =>
      executeSell(deployment, actorId, marketId, side, outcomeAmount, slippageBps),
    executeAddLiquidity: (actorId, marketId, usdcAmount) =>
      executeAddLiquidity(deployment, actorId, marketId, usdcAmount),
    executeRemoveLiquidity: (actorId, marketId, lpShares) =>
      executeRemoveLiquidity(deployment, actorId, marketId, lpShares),
    readMarketUserState: (actorId, marketId) => readMarketUserState(deployment, actors, markets, actorId, marketId),
    readMarketLifecycle: (actorId, marketId) => readMarketLifecycle(deployment, actors, actorId, marketId),
    readLpPosition: (actorId, marketId) => readLpPosition(deployment, actors, markets, actorId, marketId),
    readLpPortfolio: (actorId) => readLpPortfolio(deployment, actors, markets, actorId),
    executeCloseMarket: (actorId, marketId) => executeCloseMarket(deployment, actorId, marketId),
    executeProposeResolution: (actorId, marketId, outcome, evidenceURI) =>
      executeProposeResolution(deployment, actorId, marketId, outcome, evidenceURI),
    executeFinalizeResolution: (actorId, marketId) => executeFinalizeResolution(deployment, actorId, marketId),
    executeRedeem: (actorId, marketId) => executeRedeem(deployment, actorId, marketId),
    executeClaimCreatorFees: (actorId, marketId) => executeClaimCreatorFees(deployment, actorId, marketId),
    executeClaimProtocolFees: (actorId, marketId) => executeClaimProtocolFees(deployment, actorId, marketId),
    executeClaimCreationBond: (actorId, marketId) => executeClaimCreationBond(deployment, actorId, marketId),
    executeWarpToClose: (marketId) => executeWarpToClose(deployment, marketId),
    executeWarpChallengeWindow: (marketId) => executeWarpChallengeWindow(deployment, marketId),
  };
}

const erc20Abi = parseAbi(["function approve(address spender,uint256 value) returns (bool)"]);
const outcomeApprovalAbi = parseAbi([
  "function isApprovedForAll(address account,address operator) view returns (bool)",
  "function setApprovalForAll(address operator,bool approved)",
]);

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

async function waitForSuccess(deployment: LocalDeployment, hash: Hex) {
  const publicClient = createPublicClient({
    chain: localChain(deployment),
    transport: http(deployment.chain.rpcUrl),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction failed: ${hash}`);
  }

  return receipt;
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

async function approveOutcomeSpender(deployment: LocalDeployment, actorId: string, spender: Address) {
  const { publicClient, walletClient } = clients(deployment, actorId);
  const account = actorAccount(deployment, actorId);
  const approved = await publicClient.readContract({
    address: deployment.contracts.outcomeToken.address as Address,
    abi: outcomeApprovalAbi,
    functionName: "isApprovedForAll",
    args: [account.address, spender],
  });

  if (approved) {
    return;
  }

  const hash = await walletClient.writeContract({
    address: deployment.contracts.outcomeToken.address as Address,
    abi: outcomeApprovalAbi,
    functionName: "setApprovalForAll",
    args: [spender, true],
  });
  await waitForSuccess(deployment, hash);
}

function parseTradeAmount(deployment: LocalDeployment, amount: string) {
  const parsed = parseUnits(amount || "0", deployment.contracts.mockUSDC.decimals);
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

function tokenAmountLabel(deployment: LocalDeployment, amount: bigint, symbol: string) {
  return `${displayUnits(amount, deployment.contracts.mockUSDC.decimals)} ${symbol}`;
}

function priceFromReserves(yesReserve: bigint, noReserve: bigint) {
  const total = yesReserve + noReserve;
  if (total === 0n) {
    return { yesPrice: 0.5, noPrice: 0.5 };
  }

  const yesPrice = Number(noReserve) / Number(total);
  return { yesPrice, noPrice: 1 - yesPrice };
}

async function readMarkets(maybeDeployment: LocalDeployment | null): Promise<MarketReadModel[]> {
  const deployment = requireDeployment(maybeDeployment);
  const { publicClient } = clients(deployment, "deployer");
  const decimals = deployment.contracts.mockUSDC.decimals;

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
  deployment: LocalDeployment,
  marketId: string,
  action: TradeAction,
  amount: bigint,
  slippageBps = 100,
) {
  const market = findMarket(deployment, marketId);
  const { publicClient } = clients(deployment, "deployer");
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
  maybeDeployment: LocalDeployment | null,
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

function findMarket(deployment: LocalDeployment, marketId: string) {
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
  maybeDeployment: LocalDeployment | null,
  actors: DevActor[],
  markets: MarketReadModel[],
  actorId: string,
  marketId: string,
): Promise<LpPositionReadback> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const readModel = markets.find((candidate) => candidate.id === marketId);
  const actor = actors.find((candidate) => candidate.id === actorId);
  const actorAddress = actor?.address ?? actorAccount(deployment, actorId).address;
  const marketAddress = market.address as Address;
  const decimals = deployment.contracts.mockUSDC.decimals;
  const { publicClient } = clients(deployment, actorId);

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
  maybeDeployment: LocalDeployment | null,
  actors: DevActor[],
  actorId: string,
  marketId: string,
): Promise<MarketLifecycleReadback> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const actor = actors.find((candidate) => candidate.id === actorId);
  const actorAddress = actor?.address ?? actorAccount(deployment, actorId).address;
  const marketAddress = market.address as Address;
  const decimals = deployment.contracts.mockUSDC.decimals;
  const { publicClient } = clients(deployment, actorId);

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
      args: [actorAddress, BigInt(market.yesTokenId)],
    }),
    publicClient.readContract({
      address: deployment.contracts.outcomeToken.address as Address,
      abi: outcomeTokenAbi,
      functionName: "balanceOf",
      args: [actorAddress, BigInt(market.noTokenId)],
    }),
    publicClient.getBlock(),
  ]);
  const stateNumber = Number(state);
  const finalOutcomeNumber = Number(finalOutcome);
  const proposedOutcomeNumber = Number(proposedOutcome);
  const now = latestBlock.timestamp;
  const redeemable = stateNumber === 3 ? redeemableForOutcome(finalOutcomeNumber, yesBalance, noBalance) : 0n;
  const isCreator = actorAddress.toLowerCase() === creator.toLowerCase();
  const isProtocolRecipient = actorAddress.toLowerCase() === protocolFeeRecipient.toLowerCase();
  const isResolver = actor?.role === "Resolver";
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
  maybeDeployment: LocalDeployment | null,
  actors: DevActor[],
  markets: MarketReadModel[],
  actorId: string,
  marketId: string,
): Promise<MarketUserState> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const actor = actors.find((candidate) => candidate.id === actorId);
  const actorAddress = actor?.address ?? actorAccount(deployment, actorId).address;
  const marketAddress = market.address as Address;
  const decimals = deployment.contracts.mockUSDC.decimals;
  const { publicClient } = clients(deployment, actorId);

  const [reserves, yesBalance, noBalance, lpPosition] = await Promise.all([
    publicClient.readContract({
      address: marketAddress,
      abi: iknowMarketAbi,
      functionName: "reserves",
    }),
    publicClient.readContract({
      address: deployment.contracts.outcomeToken.address as Address,
      abi: outcomeTokenAbi,
      functionName: "balanceOf",
      args: [actorAddress, BigInt(market.yesTokenId)],
    }),
    publicClient.readContract({
      address: deployment.contracts.outcomeToken.address as Address,
      abi: outcomeTokenAbi,
      functionName: "balanceOf",
      args: [actorAddress, BigInt(market.noTokenId)],
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
  maybeDeployment: LocalDeployment | null,
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
    claimable: `${displayUnits(claimableRaw, deployment.contracts.mockUSDC.decimals)} USDC`,
  }));
  const claimable = activeReadbacks.reduce((total, position) => total + position.claimableRaw, 0n);

  return {
    actor,
    positions,
    totals: {
      yesMarkets: positions.filter((position) => position.yesShares !== "0").length,
      noMarkets: positions.filter((position) => position.noShares !== "0").length,
      lpMarkets: positions.filter((position) => position.lpShares !== "0 LP").length,
      claimable: `${displayUnits(claimable, deployment.contracts.mockUSDC.decimals)} USDC`,
    },
  };
}

async function executeCreateMarket(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  draft: MarketDraftResponse,
): Promise<MarketCreationResult> {
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

  return {
    hash,
    market: {
      id,
      address: marketAddress,
      specHash: draft.factoryArgs.specHash,
      metadataURI: draft.factoryArgs.metadataURI,
      question: draft.draft.question,
      closeTime: draft.factoryArgs.closeTime,
      resolutionSource: draft.draft.resolutionSource,
      invalidConditions: draft.draft.invalidConditions,
      creationBond: draft.factoryArgs.creationBond,
      initialLiquidity: draft.factoryArgs.initialLiquidity,
      yesTokenId: BigInt(keccak256(encodePacked(["address", "uint8"], [marketAddress, 0]))).toString(),
      noTokenId: BigInt(keccak256(encodePacked(["address", "uint8"], [marketAddress, 1]))).toString(),
    },
  };
}

async function executeBuy(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
  side: "YES" | "NO",
  usdcAmount: string,
  slippageBps = 100,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const amount = parseTradeAmount(deployment, usdcAmount);
  const quote = await quoteTrade(deployment, marketId, side === "YES" ? "BUY_YES" : "BUY_NO", amount, slippageBps);
  const marketAddress = market.address as Address;
  const { walletClient } = clients(deployment, actorId);

  await approveUsdc(deployment, actorId, marketAddress, amount);

  const hash = await walletClient.writeContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: side === "YES" ? "buyYes" : "buyNo",
    args: [amount, quote.minAmountOut],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeSell(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
  side: "YES" | "NO",
  outcomeAmount: string,
  slippageBps = 100,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const amount = parseTradeAmount(deployment, outcomeAmount);
  const quote = await quoteTrade(deployment, marketId, side === "YES" ? "SELL_YES" : "SELL_NO", amount, slippageBps);
  const marketAddress = market.address as Address;
  const { walletClient } = clients(deployment, actorId);

  await approveOutcomeSpender(deployment, actorId, marketAddress);

  const hash = await walletClient.writeContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: side === "YES" ? "sellYes" : "sellNo",
    args: [amount, quote.minAmountOut],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeAddLiquidity(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
  usdcAmount: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const amount = parseTradeAmount(deployment, usdcAmount);
  const marketAddress = market.address as Address;
  const { walletClient } = clients(deployment, actorId);

  await approveUsdc(deployment, actorId, marketAddress, maxUint256);

  const hash = await walletClient.writeContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "addLiquidity",
    args: [amount, 0n],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeRemoveLiquidity(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
  lpShares: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const shares = parseUnits(lpShares || "0", deployment.contracts.mockUSDC.decimals);
  if (shares <= 0n) {
    throw new Error("LP shares must be greater than zero");
  }
  const marketAddress = market.address as Address;
  const { walletClient } = clients(deployment, actorId);

  const hash = await walletClient.writeContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "removeLiquidity",
    args: [shares, 0n, 0n],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeCloseMarket(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { walletClient } = clients(deployment, actorId);
  const hash = await walletClient.writeContract({
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "close",
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeProposeResolution(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
  outcome: ResolutionOutcomeInput,
  evidenceURI: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { walletClient } = clients(deployment, actorId);
  const hash = await walletClient.writeContract({
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "proposeResolution",
    args: [outcomeArg(outcome), evidenceURI || "local://evidence/manual-resolution"],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeFinalizeResolution(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { walletClient } = clients(deployment, actorId);
  const hash = await walletClient.writeContract({
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "finalizeResolution",
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeRedeem(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { walletClient } = clients(deployment, actorId);
  const hash = await walletClient.writeContract({
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "redeem",
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeClaimCreatorFees(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const marketAddress = market.address as Address;
  const { publicClient, walletClient } = clients(deployment, actorId);
  const recipient = actorAccount(deployment, actorId).address;
  const amount = await publicClient.readContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "creatorFeePool",
  });
  const hash = await walletClient.writeContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "claimCreatorFees",
    args: [recipient, amount],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeClaimProtocolFees(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const marketAddress = market.address as Address;
  const { publicClient, walletClient } = clients(deployment, actorId);
  const recipient = actorAccount(deployment, actorId).address;
  const amount = await publicClient.readContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "protocolFeePool",
  });
  const hash = await walletClient.writeContract({
    address: marketAddress,
    abi: iknowMarketAbi,
    functionName: "claimProtocolFees",
    args: [recipient, amount],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function executeClaimCreationBond(
  maybeDeployment: LocalDeployment | null,
  actorId: string,
  marketId: string,
): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { walletClient } = clients(deployment, actorId);
  const recipient = actorAccount(deployment, actorId).address;
  const hash = await walletClient.writeContract({
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "claimCreationBond",
    args: [recipient],
  });

  await waitForSuccess(deployment, hash);
  return hash;
}

async function rpcRequest(deployment: LocalDeployment, method: string, params: unknown[] = []) {
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

async function mineAtOrAfter(deployment: LocalDeployment, timestamp: bigint) {
  const { publicClient } = clients(deployment, "deployer");
  const block = await publicClient.getBlock();
  if (block.timestamp < timestamp) {
    await rpcRequest(deployment, "evm_setNextBlockTimestamp", [Number(timestamp)]);
  }
  await rpcRequest(deployment, "evm_mine");
}

async function executeWarpToClose(maybeDeployment: LocalDeployment | null, marketId: string): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { publicClient } = clients(deployment, "deployer");
  const closeTime = await publicClient.readContract({
    address: market.address as Address,
    abi: iknowMarketAbi,
    functionName: "closeTime",
  });

  await mineAtOrAfter(deployment, closeTime + 1n);
  return "0x0000000000000000000000000000000000000000000000000000000000000000";
}

async function executeWarpChallengeWindow(maybeDeployment: LocalDeployment | null, marketId: string): Promise<Hex> {
  const deployment = requireDeployment(maybeDeployment);
  const market = findMarket(deployment, marketId);
  const { publicClient } = clients(deployment, "deployer");
  const finalizeAfter = await publicClient.readContract({
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
