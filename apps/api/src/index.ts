import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readLocalDeployment } from "./deployment.js";
import { createMarketDraftResponse } from "./marketDraft.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ ok: true, service: "iknow-api" });
});

app.post("/markets/draft", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(createMarketDraftResponse(body));
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

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 8787),
});
