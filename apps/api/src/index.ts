import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readLocalDeployment } from "./deployment.js";
import { createEvidencePacketResponse, prepareEvidencePacketResponse, readEvidencePacketResponse } from "./evidence.js";
import { createMarketDraftResponse } from "./marketDraft.js";

export const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ ok: true, service: "iknow-api" });
});

app.post("/markets/draft", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(createMarketDraftResponse(body));
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
    return c.json(prepareEvidencePacketResponse(body), 201);
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

const isMainModule = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMainModule) {
  serve({
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 8787),
  });
}
