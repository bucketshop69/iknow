export type IndexedEvent =
  | "MarketCreated"
  | "LiquidityAdded"
  | "LiquidityRemoved"
  | "Trade"
  | "ResolutionProposed"
  | "MarketResolved"
  | "Redeemed"
  | "LpFeesClaimed"
  | "CreatorFeesClaimed"
  | "ProtocolFeesClaimed"
  | "CreatorFeesForfeited"
  | "CreationBondClaimed"
  | "CreationBondSlashed";

export const indexedEvents: IndexedEvent[] = [
  "MarketCreated",
  "LiquidityAdded",
  "LiquidityRemoved",
  "Trade",
  "ResolutionProposed",
  "MarketResolved",
  "Redeemed",
  "LpFeesClaimed",
  "CreatorFeesClaimed",
  "ProtocolFeesClaimed",
  "CreatorFeesForfeited",
  "CreationBondClaimed",
  "CreationBondSlashed",
];
