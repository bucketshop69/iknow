import { readFile } from "node:fs/promises";
import path from "node:path";

export default async function handler(_req, res) {
  try {
    const file = await readFile(path.join(process.cwd(), "api", "arc-testnet.json"), "utf8");
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(file);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "FALLBACK_DEPLOYMENT_ERROR",
        message: error instanceof Error ? error.message : "Unable to read fallback deployment",
      }),
    );
  }
}
