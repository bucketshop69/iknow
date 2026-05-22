import { localDeploymentSchema, type LocalDeployment } from "@iknow/shared";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const defaultDeploymentPath = "contracts/deployments/local-anvil.json";

export async function readDeployment(path = defaultDeploymentPath): Promise<LocalDeployment> {
  const raw = await readFile(await resolveDeploymentPath(path), "utf8");
  const parsed = JSON.parse(raw);
  const local = localDeploymentSchema.safeParse(parsed);
  if (local.success) return local.data;

  return normalizeTestnetDeployment(parsed);
}

async function resolveDeploymentPath(path: string): Promise<string> {
  const cwdPath = resolve(process.cwd(), path);
  try {
    await readFile(cwdPath, "utf8");
    return cwdPath;
  } catch {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    return resolve(packageRoot, "../..", path);
  }
}

function normalizeTestnetDeployment(raw: unknown): LocalDeployment {
  const value = raw as {
    schemaVersion?: number;
    generatedAtBlockTimestamp?: number;
    chain?: { id?: number; name?: string; rpcUrl?: string };
    contracts?: {
      usdc?: { address?: string; decimals?: number };
      mockUSDC?: { address?: string; decimals?: number };
      outcomeToken?: { address?: string };
      iknowMarketFactory?: { address?: string };
    };
    actors?: {
      deployer?: string;
      creator?: string;
      traderYes?: string;
      traderNo?: string;
      liquidityProvider?: string;
      resolver?: string;
      protocolFeeRecipient?: string;
      protocol?: string;
    };
    markets?: unknown[];
  };
  const resolverPrivateKey = process.env.RESOLVER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!resolverPrivateKey) {
    throw new Error("Testnet deployment needs RESOLVER_PRIVATE_KEY or PRIVATE_KEY in the environment");
  }

  const actors = value.actors ?? {};
  const resolver = actors.resolver ?? actors.deployer;
  const deployer = actors.deployer ?? resolver;
  const protocol = actors.protocolFeeRecipient ?? actors.protocol ?? resolver;
  if (!deployer || !resolver || !protocol) {
    throw new Error("Testnet deployment actors must include deployer/resolver/protocol addresses");
  }

  const usdc = value.contracts?.mockUSDC ?? value.contracts?.usdc;
  const normalized = {
    schemaVersion: value.schemaVersion ?? 1,
    generatedAtBlockTimestamp: value.generatedAtBlockTimestamp ?? Math.floor(Date.now() / 1000),
    chain: {
      id: value.chain?.id,
      name: value.chain?.name,
      rpcUrl: process.env.ARC_TESTNET_RPC_URL ?? process.env.RPC ?? value.chain?.rpcUrl,
    },
    contracts: {
      mockUSDC: usdc,
      outcomeToken: value.contracts?.outcomeToken,
      iknowMarketFactory: value.contracts?.iknowMarketFactory,
    },
    actors: {
      deployer: { address: deployer, privateKey: resolverPrivateKey },
      creator: { address: actors.creator ?? deployer, privateKey: resolverPrivateKey },
      traderYes: { address: actors.traderYes ?? deployer, privateKey: resolverPrivateKey },
      traderNo: { address: actors.traderNo ?? deployer, privateKey: resolverPrivateKey },
      liquidityProvider: { address: actors.liquidityProvider ?? deployer, privateKey: resolverPrivateKey },
      resolver: { address: resolver, privateKey: resolverPrivateKey },
      protocol: { address: protocol, privateKey: resolverPrivateKey },
    },
    markets: value.markets ?? [],
  };

  return localDeploymentSchema.parse(normalized);
}
