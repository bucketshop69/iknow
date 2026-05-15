import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createMarketDraftResponse } from "./marketDraft.js";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ ok: true, service: "iknow-api" });
});

app.post("/markets/draft", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(createMarketDraftResponse(body));
});

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 8787),
});
