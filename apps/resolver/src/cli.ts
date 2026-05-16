import { readDeployment, defaultDeploymentPath } from "./deployment.js";
import { finalizeMarkets, prepareMarkets, proposeMarkets, type RunnerOptions } from "./runner.js";

type Command = "prepare" | "propose" | "finalize";

async function main() {
  const args = process.argv.slice(2);
  const command = parseCommand(args[0]);
  const options = parseOptions(args.slice(1));
  const deployment = await readDeployment(options.deploymentPath);

  if (command === "prepare") {
    const results = await prepareMarkets(deployment, options);
    console.log(JSON.stringify({ command, results }, null, 2));
    return;
  }

  if (command === "propose") {
    const hashes = await proposeMarkets(deployment, options);
    console.log(JSON.stringify({ command, submitted: hashes }, null, 2));
    return;
  }

  const hashes = await finalizeMarkets(deployment, options);
  console.log(JSON.stringify({ command, submitted: hashes }, null, 2));
}

function parseCommand(value: string | undefined): Command {
  if (value === "prepare" || value === "propose" || value === "finalize") return value;
  throw new Error("Usage: tsx src/cli.ts <prepare|propose|finalize> [--market <id|address>] [--allow-propose] [--allow-finalize]");
}

function parseOptions(args: string[]): RunnerOptions & { deploymentPath: string } {
  const options: RunnerOptions & { deploymentPath: string } = {
    deploymentPath: process.env.DEPLOYMENT_PATH ?? defaultDeploymentPath,
    apiBaseUrl: process.env.API_BASE_URL ?? "http://localhost:8787",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--deployment") {
      options.deploymentPath = requireValue(args, ++index, arg);
    } else if (arg === "--market") {
      options.marketId = requireValue(args, ++index, arg);
    } else if (arg === "--agent-id") {
      options.agentId = requireValue(args, ++index, arg);
    } else if (arg === "--api-base-url") {
      options.apiBaseUrl = requireValue(args, ++index, arg);
    } else if (arg === "--min-confidence") {
      options.minConfidence = Number(requireValue(args, ++index, arg));
    } else if (arg === "--no-post") {
      options.postEvidence = false;
    } else if (arg === "--allow-propose") {
      options.allowPropose = true;
    } else if (arg === "--allow-finalize") {
      options.allowFinalize = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
