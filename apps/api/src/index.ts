import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  readLocalDeployment,
  readTestnetDeployment,
  refreshTestnetDeploymentMarkets,
  upsertLocalDeploymentMarket,
  upsertTestnetDeploymentMarket,
} from "./deployment.js";
import { createEvidencePacketResponse, prepareEvidencePacketResponse, readEvidencePacketResponse } from "./evidence.js";
import { MARKET_IMPORT_TAGS, listMarketImportCandidates } from "./marketImport.js";
import { logMarketImportReview, reviewMarketImportCandidate } from "./marketImportReview.js";
import { createMarketDraftResponse } from "./marketDraft.js";

loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

export const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ ok: true, service: "iknow-api" });
});

app.post("/markets/draft", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(createMarketDraftResponse(body));
  } catch (error) {
    return c.json(
      {
        error: "INVALID_MARKET_DRAFT",
        message: error instanceof Error ? error.message : "Market draft is invalid",
      },
      400,
    );
  }
});

app.get("/market-import/tags", (c) => {
  return c.json({ tags: MARKET_IMPORT_TAGS });
});

app.get("/market-import/candidates", async (c) => {
  try {
    const candidates = await listMarketImportCandidates({
      tagSlug: c.req.query("tag") ?? undefined,
      query: c.req.query("q") ?? "",
      limit: Number(c.req.query("limit") ?? 24),
    });

    return c.json({ candidates });
  } catch (error) {
    return c.json(
      {
        error: "MARKET_IMPORT_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Unable to fetch market ideas",
      },
      502,
    );
  }
});

app.post("/market-import/review", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    const response = await reviewMarketImportCandidate(body);
    logMarketImportReview(response.review);

    return c.json(response);
  } catch (error) {
    return c.json(
      {
        error: "MARKET_IMPORT_REVIEW_FAILED",
        message: error instanceof Error ? error.message : "Unable to review market import",
      },
      400,
    );
  }
});

app.post("/local/evidence", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    return c.json(createEvidencePacketResponse(body), 201);
  } catch (error) {
    return c.json(
      {
        error: "INVALID_EVIDENCE_PACKET",
        message: error instanceof Error ? error.message : "Evidence packet is invalid",
      },
      400,
    );
  }
});

app.post("/evidence", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    return c.json(createEvidencePacketResponse(body), 201);
  } catch (error) {
    return c.json(
      {
        error: "INVALID_EVIDENCE_PACKET",
        message: error instanceof Error ? error.message : "Evidence packet is invalid",
      },
      400,
    );
  }
});

app.post("/evidence/prepare", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    return c.json(await prepareEvidencePacketResponse(body), 201);
  } catch (error) {
    return c.json(
      {
        error: "EVIDENCE_PREPARE_FAILED",
        message: error instanceof Error ? error.message : "Unable to prepare evidence packet",
      },
      400,
    );
  }
});

app.get("/local/evidence", (c) => {
  const lookup = c.req.query("uri") ?? c.req.query("hash");
  if (!lookup) {
    return c.json(
      {
        error: "EVIDENCE_LOOKUP_REQUIRED",
        message: "Provide an evidence uri or packet hash",
      },
      400,
    );
  }

  const response = readEvidencePacketResponse(lookup);

  if (!response) {
    return c.json(
      {
        error: "EVIDENCE_PACKET_NOT_FOUND",
        message: "Evidence packet was not found in local API storage",
      },
      404,
    );
  }

  return c.json(response);
});

app.get("/evidence", (c) => {
  const lookup = c.req.query("uri") ?? c.req.query("hash");
  if (!lookup) {
    return c.json(
      {
        error: "EVIDENCE_LOOKUP_REQUIRED",
        message: "Provide an evidence uri or packet hash",
      },
      400,
    );
  }

  const response = readEvidencePacketResponse(lookup);

  if (!response) {
    return c.json(
      {
        error: "EVIDENCE_PACKET_NOT_FOUND",
        message: "Evidence packet was not found in local API storage",
      },
      404,
    );
  }

  return c.json(response);
});

app.get("/local/evidence/:hash", (c) => {
  const response = readEvidencePacketResponse(c.req.param("hash"));

  if (!response) {
    return c.json(
      {
        error: "EVIDENCE_PACKET_NOT_FOUND",
        message: "Evidence packet was not found in local API storage",
      },
      404,
    );
  }

  return c.json(response);
});

app.get("/evidence/:hash", (c) => {
  const response = readEvidencePacketResponse(c.req.param("hash"));

  if (!response) {
    return c.json(
      {
        error: "EVIDENCE_PACKET_NOT_FOUND",
        message: "Evidence packet was not found in local API storage",
      },
      404,
    );
  }

  return c.json(response);
});

app.get("/local/deployment", async (c) => {
  try {
    return c.json(await readLocalDeployment());
  } catch (error) {
    return c.json(
      {
        error: "LOCAL_DEPLOYMENT_NOT_READY",
        message: error instanceof Error ? error.message : "Unable to read local deployment artifact",
      },
      503,
    );
  }
});

app.post("/local/deployment/markets", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    const deployment = await upsertLocalDeploymentMarket(body.market);

    return c.json({ market: deployment.markets[0], deployment }, 201);
  } catch (error) {
    return c.json(
      {
        error: "LOCAL_MARKET_PERSIST_FAILED",
        message: error instanceof Error ? error.message : "Unable to persist local market",
      },
      400,
    );
  }
});

app.get("/testnet/deployment", async (c) => {
  try {
    const shouldRefresh =
      c.req.query("refresh") !== "false" && process.env.IKNOW_TESTNET_INDEX_ON_READ !== "false";

    if (!shouldRefresh) {
      return c.json(await readTestnetDeployment());
    }

    try {
      const result = await refreshTestnetDeploymentMarkets();

      return c.json({
        ...result.deployment,
        indexing: {
          status: "fresh",
          indexed: result.indexed,
          added: result.added,
          updated: result.updated,
        },
      });
    } catch (indexError) {
      return c.json({
        ...(await readTestnetDeployment()),
        indexing: {
          status: "stale",
          error: indexError instanceof Error ? indexError.message : "Unable to refresh Arc testnet market index",
        },
      });
    }
  } catch (error) {
    return c.json(
      {
        error: "TESTNET_DEPLOYMENT_NOT_READY",
        message: error instanceof Error ? error.message : "Unable to read Arc testnet deployment artifact",
      },
      503,
    );
  }
});

app.post("/testnet/deployment/index", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    const result = await refreshTestnetDeploymentMarkets({
      fromBlock:
        typeof body.fromBlock === "string" || typeof body.fromBlock === "number" ? BigInt(body.fromBlock) : undefined,
      toBlock: typeof body.toBlock === "string" || typeof body.toBlock === "number" ? BigInt(body.toBlock) : undefined,
    });

    return c.json({
      indexed: result.indexed,
      added: result.added,
      updated: result.updated,
      deployment: result.deployment,
    });
  } catch (error) {
    return c.json(
      {
        error: "TESTNET_MARKET_INDEX_FAILED",
        message: error instanceof Error ? error.message : "Unable to index Arc testnet markets",
      },
      502,
    );
  }
});

app.post("/testnet/deployment/markets", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    const deployment = await upsertTestnetDeploymentMarket(body.market);

    return c.json({ market: deployment.markets[0], deployment }, 201);
  } catch (error) {
    return c.json(
      {
        error: "TESTNET_MARKET_PERSIST_FAILED",
        message: error instanceof Error ? error.message : "Unable to persist Arc testnet market",
      },
      400,
    );
  }
});

const isMainModule = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMainModule) {
  serve({
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 8787),
  });
}
