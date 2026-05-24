import type { ImportResolutionReview } from "@iknow/shared";

export type Route =
  | { screen: "landing" }
  | { screen: "markets" }
  | { screen: "market"; marketId: string }
  | { screen: "create" }
  | { screen: "profile" };

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
  imageUrl?: string;
  sourceIdea?: MarketSourceIdeaReadModel;
  importReview?: ImportResolutionReview;
}

export interface MarketUserState {
  yesReserve: string;
  noReserve: string;
  yesBalance: string;
  noBalance: string;
  lpShares: string;
  pendingLpFees: string;
  totalLpShares: string;
  yesBalanceRaw: string;
  noBalanceRaw: string;
  lpSharesRaw: string;
  pendingLpFeesRaw: string;
}

export interface PortfolioPosition {
  marketId: string;
  marketQuestion: string;
  status: MarketStatus;
  resolution: string;
  yesShares: string;
  noShares: string;
  lpShares: string;
  pendingLpFees: string;
  redeemable: string;
  creatorFees: string;
  protocolFees: string;
  creationBond: string;
  yesSharesRaw: string;
  noSharesRaw: string;
  lpSharesRaw: string;
  pendingLpFeesRaw: string;
  redeemableRaw: string;
  creatorFeesRaw: string;
  protocolFeesRaw: string;
  creationBondRaw: string;
  isCreator: boolean;
  canRedeem: boolean;
  canClaimCreatorFees: boolean;
  canClaimProtocolFees: boolean;
  canClaimCreationBond: boolean;
}

export interface LpPositionReadback {
  marketId: string;
  marketQuestion: string;
  lpShares: string;
  pendingFees: string;
  totalLpShares: string;
  lpSharesRaw: string;
  pendingFeesRaw: string;
}

export interface MarketLifecycleReadback {
  state: MarketStatus;
  proposedOutcome: string;
  finalOutcome: string;
  closeTime: string;
  finalizeAfter: string;
  evidenceURI: string;
  redeemable: string;
  creatorFees: string;
  protocolFees: string;
  creationBond: string;
  redeemableRaw: string;
  creatorFeesRaw: string;
  protocolFeesRaw: string;
  creationBondRaw: string;
  isCreator: boolean;
  canClose: boolean;
  canPropose: boolean;
  canFinalize: boolean;
  canRedeem: boolean;
  canClaimCreatorFees: boolean;
  canClaimProtocolFees: boolean;
  canClaimCreationBond: boolean;
}

export interface EvidenceFactReadModel {
  label: string;
  value: string;
}

export interface EvidenceLinkReadModel {
  label: string;
  url: string;
  source?: string;
  timestamp?: string;
}

export interface EvidenceInvalidCheckReadModel {
  label: string;
  status: "pass" | "fail" | "unknown";
  note?: string;
}

export interface EvidenceBriefReadModel {
  id: string;
  evidenceURI: string;
  suggestedOutcome: "YES" | "NO" | "INVALID" | "UNKNOWN";
  confidence: number | null;
  facts: EvidenceFactReadModel[];
  evidenceLinks: EvidenceLinkReadModel[];
  invalidChecks: EvidenceInvalidCheckReadModel[];
  generatedAt: string;
  agentId: string;
  policyStatus: string;
}

export interface EvidencePrepareInput {
  actorId: string;
  market: MarketReadModel;
}

export interface PortfolioReadModel {
  actor: DevActor;
  positions: PortfolioPosition[];
  totals: {
    yesMarkets: number;
    noMarkets: number;
    lpMarkets: number;
    winnings: string;
    creatorEarnings: string;
    protocolFees: string;
    safetyDeposit: string;
    lpFees: string;
    readyActions: number;
  };
}

export interface CreateDraftInput {
  question: string;
  closeTime: string;
  resolutionSource: string;
  invalidConditions: string;
  creationBond: string;
  initialLiquidity: string;
  imageUrl?: string;
  sourceIdea?: MarketSourceIdeaReadModel;
  importReview?: ImportResolutionReview;
}

export interface MarketSourceIdeaReadModel {
  provider: string;
  externalId: string;
  url?: string;
  imageUrl?: string;
  question?: string;
  closeTime?: string;
}

export interface MarketImportTag {
  slug: string;
  label: string;
  id: number;
}

export interface MarketImportCandidate {
  id: string;
  externalId: string;
  tagSlug: string;
  tagLabel: string;
  question: string;
  closeTime: string;
  resolutionSource: string;
  invalidConditions: string[];
  description: string;
  imageUrl?: string;
  sourceUrl?: string;
  sourceProvider?: string;
  liquidity?: string;
  volume?: string;
  volume24hr?: string;
}

export interface MarketImportReviewResult {
  review: ImportResolutionReview;
  draftPatch: {
    resolutionSource: string;
    invalidConditions: string[];
  };
}
