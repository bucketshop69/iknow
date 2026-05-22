import { createHash } from "node:crypto";
import {
  CREATE_MIN_CREATION_BOND_USDC,
  CREATE_MIN_INITIAL_LIQUIDITY_USDC,
  marketDraftResponseSchema,
  marketDraftSchema,
} from "@iknow/shared";

const ONE_USDC = 1_000_000n;
const MIN_CREATION_BOND = BigInt(CREATE_MIN_CREATION_BOND_USDC) * ONE_USDC;
const MIN_INITIAL_LIQUIDITY = BigInt(CREATE_MIN_INITIAL_LIQUIDITY_USDC) * ONE_USDC;
const DEFAULT_CREATION_BOND = MIN_CREATION_BOND;
const DEFAULT_INITIAL_LIQUIDITY = MIN_INITIAL_LIQUIDITY;
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
  creationBond?: unknown;
  initialLiquidity?: unknown;
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
  const closeTimeSeconds = Math.floor(Date.parse(draft.closeTime) / 1000);
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
  const specHash = _specHash(specHashInput);
  const factoryArgs = {
    specHash,
    metadataURI: `urn:iknow:market:${specHash}`,
    closeTime: closeTimeSeconds,
    creationBond: _parseUsdcUnits(body.creationBond, DEFAULT_CREATION_BOND, MIN_CREATION_BOND, "Safety deposit").toString(),
    initialLiquidity: _parseUsdcUnits(
      body.initialLiquidity,
      DEFAULT_INITIAL_LIQUIDITY,
      MIN_INITIAL_LIQUIDITY,
      "Money to start the market",
    ).toString(),
  };

  return marketDraftResponseSchema.parse({ draft, specHashInput, factoryArgs });
}

function _defaultCloseTime() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function _specHash(input: unknown) {
  return `0x${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}

function _parseUsdcUnits(value: unknown, fallback: bigint, minimum: bigint, label: string) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const text = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    throw new Error("USDC amounts must be positive numbers with at most 6 decimal places");
  }

  const [whole, fraction = ""] = text.split(".");
  const parsed = BigInt(whole) * ONE_USDC + BigInt(fraction.padEnd(6, "0"));
  if (parsed < minimum) {
    throw new Error(`${label} must be at least ${_formatUsdcUnits(minimum)} USDC`);
  }

  return parsed;
}

function _formatUsdcUnits(value: bigint) {
  const whole = value / ONE_USDC;
  const fraction = (value % ONE_USDC).toString().padStart(6, "0").replace(/0+$/g, "");

  return `${whole}${fraction ? `.${fraction}` : ""}`;
}
