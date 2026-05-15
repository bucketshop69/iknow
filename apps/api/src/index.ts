import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ ok: true, service: "iknow-api" });
});

app.post("/markets/draft", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json({
    draft: {
      question: body.question ?? "Will this market resolve YES by the deadline?",
      outcomes: ["YES", "NO"],
      status: "placeholder",
    },
  });
});

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 8787),
});
