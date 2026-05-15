export type IndexedEvent =
  | "MarketCreated"
  | "LiquidityAdded"
  | "LiquidityRemoved"
  | "Trade"
  | "ResolutionProposed"
  | "MarketResolved"
  | "Redeemed"
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
  "CreationBondClaimed",
  "CreationBondSlashed",
];
