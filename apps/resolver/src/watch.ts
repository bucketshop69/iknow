import "dotenv/config";
import { readDeployment, defaultDeploymentPath } from "./deployment.js";
import { finalizeMarkets, prepareMarkets, proposeMarkets, type ResolverBrainMode } from "./runner.js";

type WatchOptions = {
  deploymentPath: string;
  marketId?: string;
  apiBaseUrl: string;
  brainMode: ResolverBrainMode;
  intervalMs: number;
  once: boolean;
};

async function main() {
  const options = parseOptions(process.argv.slice(2));
  do {
    await tick(options);
    if (options.once) break;
    await sleep(options.intervalMs);
  } while (true);
}

async function tick(options: WatchOptions) {
  const deployment = await readDeployment(options.deploymentPath);
  const prepareResults = await prepareMarkets(deployment, {
    marketId: options.marketId,
    apiBaseUrl: options.apiBaseUrl,
    brainMode: options.brainMode,
  });
  console.log(JSON.stringify({ event: "resolver.prepare", results: prepareResults }, null, 2));

  const proposed = await proposeMarkets(deployment, {
    marketId: options.marketId,
    apiBaseUrl: options.apiBaseUrl,
    brainMode: options.brainMode,
    allowPropose: true,
  });
  if (proposed.length) {
    console.log(JSON.stringify({ event: "resolver.propose", submitted: proposed }, null, 2));
  }

  const finalized = await finalizeMarkets(deployment, {
    marketId: options.marketId,
    allowFinalize: true,
  });
  if (finalized.length) {
    console.log(JSON.stringify({ event: "resolver.finalize", submitted: finalized }, null, 2));
  }
}

function parseOptions(args: string[]): WatchOptions {
  const options: WatchOptions = {
    deploymentPath: process.env.DEPLOYMENT_PATH ?? defaultDeploymentPath,
    apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:8787",
    brainMode: parseBrainMode(process.env.RESOLVER_BRAIN ?? "auto"),
    intervalMs: Number(process.env.RESOLVER_WATCH_INTERVAL_MS ?? 30_000),
    once: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--deployment") {
      options.deploymentPath = requireValue(args, ++index, arg);
    } else if (arg === "--market") {
      options.marketId = requireValue(args, ++index, arg);
    } else if (arg === "--api-base-url") {
      options.apiBaseUrl = requireValue(args, ++index, arg);
    } else if (arg === "--brain") {
      options.brainMode = parseBrainMode(requireValue(args, ++index, arg));
    } else if (arg === "--interval-ms") {
      options.intervalMs = Number(requireValue(args, ++index, arg));
    } else if (arg === "--once") {
      options.once = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parseBrainMode(value: string): ResolverBrainMode {
  if (value === "auto" || value === "mock" || value === "llm") return value;
  throw new Error(`Invalid brain mode: ${value}`);
}

function requireValue(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
