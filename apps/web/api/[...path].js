import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ONE_USDC = 1_000_000n;
const MIN_CREATION_BOND = 5n * ONE_USDC;
const MIN_INITIAL_LIQUIDITY = 10n * ONE_USDC;

export default async function handler(req, res) {
  const route = Array.isArray(req.query.path) ? req.query.path.join("/") : req.query.path ?? "";

  try {
    if (req.method === "GET" && route === "health") {
      return json(res, 200, { ok: true, service: "iknow-api", mode: "vercel-fallback" });
    }

    if (req.method === "GET" && route === "testnet/deployment") {
      return json(res, 200, await readArcDeployment());
    }

    if (req.method === "POST" && route === "markets/draft") {
      return json(res, 200, createMarketDraftResponse(await readJson(req)));
    }

    if (req.method === "GET" && route === "market-import/tags") {
      return json(res, 200, { tags: [] });
    }

    if (req.method === "GET" && route === "market-import/candidates") {
      return json(res, 200, { candidates: [] });
    }

    if (req.method === "POST" && route === "market-import/review") {
      const body = await readJson(req);
      return json(res, 200, createImportReviewResponse(body));
    }

    return json(res, 404, { error: "NOT_FOUND", message: `No fallback route for ${req.method} /api/${route}` });
  } catch (error) {
    return json(res, 500, {
      error: "FALLBACK_API_ERROR",
      message: error instanceof Error ? error.message : "Fallback API failed",
    });
  }
}

async function readArcDeployment() {
  const file = await readFile(fileURLToPath(new URL("./arc-testnet.json", import.meta.url)), "utf8");
  return JSON.parse(file);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function createMarketDraftResponse(body) {
  const closeTime = typeof body.closeTime === "string" ? body.closeTime : defaultCloseTime();
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

function createImportReviewResponse(body) {
  const candidate = body?.candidate ?? body ?? {};
  const closeTime = typeof candidate.closeTime === "number" ? candidate.closeTime : Math.floor(Date.now() / 1000) + 604800;
  const resolutionSource =
    typeof candidate.resolutionSource === "string"
      ? candidate.resolutionSource
      : "Creator-provided evidence with resolver verification.";
  const invalidConditions = Array.isArray(candidate.invalidConditions)
    ? candidate.invalidConditions
    : ["The question cannot be objectively resolved from the listed resolution source."];

  return {
    draftPatch: { resolutionSource, invalidConditions },
    review: {
      status: "ready",
      score: 0.75,
      blockers: [],
      warnings: ["Fallback review is active while the hosted API is unavailable."],
      rewrittenResolutionSource: resolutionSource,
      rewrittenInvalidConditions: invalidConditions,
      requiredCapabilities: ["public evidence review"],
      missingCapabilities: [],
      reviewerReports: [],
      evidencePlan: ["Check the stated resolution source after market close."],
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

function defaultCloseTime() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}
