import { createHash } from "node:crypto";
import { marketDraftResponseSchema, marketDraftSchema } from "@iknow/shared";

const ONE_USDC = 1_000_000n;
const DEFAULT_CREATION_BOND = 100n * ONE_USDC;
const DEFAULT_INITIAL_LIQUIDITY = 1_000n * ONE_USDC;
const DEFAULT_RESOLUTION_SOURCE = "Creator-provided evidence with resolver verification.";
const DEFAULT_INVALID_CONDITIONS = [
  "The question cannot be objectively resolved from the listed resolution source.",
  "The event is cancelled, materially changed, or lacks a clear final result.",
];

type DraftRequest = {
  question?: unknown;
  closeTime?: unknown;
  resolutionSource?: unknown;
  invalidConditions?: unknown;
};

export function createMarketDraftResponse(body: DraftRequest) {
  const closeTime = typeof body.closeTime === "string" ? body.closeTime : _defaultCloseTime();
  const draft = marketDraftSchema.parse({
    question: typeof body.question === "string" ? body.question : "Will this market resolve YES by the deadline?",
    closeTime,
    resolutionSource: typeof body.resolutionSource === "string" ? body.resolutionSource : DEFAULT_RESOLUTION_SOURCE,
    invalidConditions: Array.isArray(body.invalidConditions) ? body.invalidConditions : DEFAULT_INVALID_CONDITIONS,
    outcomes: ["YES", "NO"],
  });

  const specHashInput = {
    question: draft.question,
    outcomes: draft.outcomes,
    closeTime: draft.closeTime,
    resolutionSource: draft.resolutionSource,
    invalidConditions: draft.invalidConditions,
  };
  const specHash = _specHash(specHashInput);
  const factoryArgs = {
    specHash,
    metadataURI: `urn:iknow:market:${specHash}`,
    closeTime: Math.floor(Date.parse(draft.closeTime) / 1000),
    creationBond: DEFAULT_CREATION_BOND.toString(),
    initialLiquidity: DEFAULT_INITIAL_LIQUIDITY.toString(),
  };

  return marketDraftResponseSchema.parse({ draft, specHashInput, factoryArgs });
}

function _defaultCloseTime() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function _specHash(input: unknown) {
  return `0x${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}
