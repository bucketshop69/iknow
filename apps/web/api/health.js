export default function handler(_req, res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({ ok: true, service: "iknow-api", mode: "vercel-fallback" }));
}
