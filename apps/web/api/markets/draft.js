import { createHash } from "node:crypto";

const ONE_USDC = 1_000_000n;
const MIN_CREATION_BOND = 5n * ONE_USDC;
const MIN_INITIAL_LIQUIDITY = 10n * ONE_USDC;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
  }

  try {
    return json(res, 200, createMarketDraftResponse(await readJson(req)));
  } catch (error) {
    return json(res, 400, {
      error: "INVALID_MARKET_DRAFT",
      message: error instanceof Error ? error.message : "Market draft is invalid",
    });
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function createMarketDraftResponse(body) {
  const closeTime = typeof body.closeTime === "string" ? body.closeTime : new Date(Date.now() + 604800000).toISOString();
  const invalidConditions = Array.isArray(body.invalidConditions)
    ? body.invalidConditions
    : ["The question cannot be objectively resolved from the listed resolution source."];
  const draft = {
    question: typeof body.question === "string" ? body.question : "Will this market resolve YES by the deadline?",
    closeTime,
    resolutionSource:
      typeof body.resolutionSource === "string" ? body.resolutionSource : "Creator-provided evidence with resolver verification.",
    invalidConditions,
    outcomes: ["YES", "NO"],
  };
  const closeTimeSeconds = Math.floor(Date.parse(draft.closeTime) / 1000);
  if (closeTimeSeconds <= Math.floor(Date.now() / 1000)) throw new Error("closeTime must be in the future");

  const specHashInput = {
    question: draft.question,
    outcomes: draft.outcomes,
    closeTime: draft.closeTime,
    resolutionSource: draft.resolutionSource,
    invalidConditions: draft.invalidConditions,
  };
  const specHash = `0x${createHash("sha256").update(JSON.stringify(specHashInput)).digest("hex")}`;

  return {
    draft,
    specHashInput,
    factoryArgs: {
      specHash,
      metadataURI: `urn:iknow:market:${specHash}`,
      closeTime: closeTimeSeconds,
      creationBond: parseUsdcUnits(body.creationBond, MIN_CREATION_BOND, MIN_CREATION_BOND).toString(),
      initialLiquidity: parseUsdcUnits(body.initialLiquidity, MIN_INITIAL_LIQUIDITY, MIN_INITIAL_LIQUIDITY).toString(),
    },
  };
}

function parseUsdcUnits(value, fallback, minimum) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return fallback;
  const [whole, fraction = ""] = text.split(".");
  const parsed = BigInt(whole) * ONE_USDC + BigInt(fraction.padEnd(6, "0"));
  return parsed < minimum ? minimum : parsed;
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}
