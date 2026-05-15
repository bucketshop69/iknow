export type IndexedEvent =
  | "MarketCreated"
  | "LiquidityAdded"
  | "LiquidityRemoved"
  | "Trade"
  | "ResolutionProposed"
  | "MarketResolved"
  | "Redeemed"
  | "ProtocolFeesClaimed"
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
  "ProtocolFeesClaimed",
  "CreationBondClaimed",
  "CreationBondSlashed",
];
