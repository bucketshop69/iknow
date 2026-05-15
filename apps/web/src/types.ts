export type Route =
  | { screen: "markets" }
  | { screen: "market"; marketId: string }
  | { screen: "create" }
  | { screen: "portfolio" };

export type MarketStatus =
  | "Open"
  | "Closing soon"
  | "Closed"
  | "Resolution proposed"
  | "Resolved";

export type DevActorRole =
  | "Deployer"
  | "Creator"
  | "TraderYes"
  | "TraderNo"
  | "LiquidityProvider"
  | "Resolver"
  | "Protocol";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export interface DevActor {
  id: string;
  name: string;
  role: DevActorRole;
  address: Address;
  usdcBalance: string;
}

export interface ContractSurface {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  marketFactory?: Address;
  outcomeToken?: Address;
  abiSummary: {
    factoryFunctions: string[];
    marketFunctions: string[];
    outcomeTokenFunctions: string[];
  };
}

export interface MarketReadModel {
  id: string;
  address?: Address;
  question: string;
  status: MarketStatus;
  closeTime: string;
  resolutionSource: string;
  invalidConditions: string[];
  metadataURI: string;
  specHash: Hex;
  creator: string;
  yesPrice: number;
  noPrice: number;
  liquidity: string;
  yesReserve: string;
  noReserve: string;
  volume24h: string;
}

export interface PortfolioPosition {
  marketId: string;
  marketQuestion: string;
  yesShares: string;
  noShares: string;
  lpShares: string;
  claimable: string;
}

export interface PortfolioReadModel {
  actor: DevActor;
  positions: PortfolioPosition[];
  totals: {
    yesMarkets: number;
    noMarkets: number;
    lpMarkets: number;
    claimable: string;
  };
}

export interface CreateDraftInput {
  question: string;
  closeTime: string;
  resolutionSource: string;
  invalidConditions: string;
  creationBond: string;
  initialLiquidity: string;
}
