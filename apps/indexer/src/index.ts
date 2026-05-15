export type IndexedEvent =
  | "MarketCreated"
  | "LiquidityAdded"
  | "LiquidityRemoved"
  | "Trade"
  | "ResolutionProposed"
  | "MarketResolved"
  | "Redeemed";

export const indexedEvents: IndexedEvent[] = [
  "MarketCreated",
  "LiquidityAdded",
  "LiquidityRemoved",
  "Trade",
  "ResolutionProposed",
  "MarketResolved",
  "Redeemed",
];
