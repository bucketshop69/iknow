import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deployedMarketSchema, localDeploymentSchema, type DeployedMarket, type LocalDeployment } from "@iknow/shared";
import {
  createPublicClient,
  encodePacked,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";

export const DEFAULT_DEPLOYMENT_PATH = "contracts/deployments/local-anvil.json";
export const DEFAULT_TESTNET_DEPLOYMENT_PATH = "contracts/deployments/arc-testnet.json";

const marketCreatedAbi = parseAbi([
  "event MarketCreated(address indexed market,address indexed creator,bytes32 indexed specHash,string metadataURI,uint256 closeTime,uint256 creationBond,uint256 initialLiquidity)",
]);

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const testnetDeploymentSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAtBlockTimestamp: z.number().int().positive(),
  chain: z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    rpcUrl: z.string().url(),
  }),
  contracts: z.object({
    usdc: z.object({
      address: addressSchema,
      decimals: z.number().int().positive(),
    }),
    outcomeToken: z.object({
      address: addressSchema,
    }),
    iknowMarketFactory: z.object({
      address: addressSchema,
      defaultChallengeWindow: z.number().int().positive().optional(),
      indexStartBlock: z.number().int().nonnegative().optional(),
    }),
  }),
  actors: z
    .object({
      deployer: addressSchema.optional(),
      resolver: addressSchema.optional(),
      protocolFeeRecipient: addressSchema.optional(),
    })
    .default({}),
  markets: z.array(deployedMarketSchema),
});

export type TestnetDeployment = z.infer<typeof testnetDeploymentSchema>;

export type MarketCreatedEventLike = {
  args: {
    market?: Address;
    creator?: Address;
    specHash?: Hex;
    metadataURI?: string;
    closeTime?: bigint;
    creationBond?: bigint;
    initialLiquidity?: bigint;
  };
  blockNumber?: bigint | null;
  logIndex?: number | null;
  transactionHash?: Hex | null;
};

export type TestnetMarketIndexResult = {
  deployment: TestnetDeployment;
  indexed: number;
  added: number;
  updated: number;
};

export async function readLocalDeployment(
  deploymentPath = process.env.IKNOW_DEPLOYMENT_PATH ?? DEFAULT_DEPLOYMENT_PATH,
): Promise<LocalDeployment> {
  const candidates = deploymentPathCandidates(deploymentPath);
  let file: string | undefined;
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      file = await readFile(candidate, "utf8");
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!file) {
    throw lastError instanceof Error ? lastError : new Error(`Unable to read ${deploymentPath}`);
  }

  return localDeploymentSchema.parse(JSON.parse(file));
}

export async function upsertLocalDeploymentMarket(
  marketInput: unknown,
  deploymentPath = process.env.IKNOW_DEPLOYMENT_PATH ?? DEFAULT_DEPLOYMENT_PATH,
): Promise<LocalDeployment> {
  const market = deployedMarketSchema.parse(marketInput);
  const artifactPath = await resolveExistingDeploymentPath(deploymentPath);
  const deployment = await readLocalDeployment(artifactPath);
  const markets = [market, ...deployment.markets.filter((candidate) => !sameMarketRecord(candidate, market))];
  const nextDeployment = localDeploymentSchema.parse({ ...deployment, markets });

  await writeFile(artifactPath, `${JSON.stringify(nextDeployment, null, 2)}\n`);

  return nextDeployment;
}

export async function readTestnetDeployment(
  deploymentPath = process.env.IKNOW_TESTNET_DEPLOYMENT_PATH ?? DEFAULT_TESTNET_DEPLOYMENT_PATH,
): Promise<TestnetDeployment> {
  const candidates = deploymentPathCandidates(deploymentPath);
  let file: string | undefined;
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      file = await readFile(candidate, "utf8");
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!file) {
    throw lastError instanceof Error ? lastError : new Error(`Unable to read ${deploymentPath}`);
  }

  return testnetDeploymentSchema.parse(JSON.parse(file));
}

export async function refreshTestnetDeploymentMarkets({
  deploymentPath = process.env.IKNOW_TESTNET_DEPLOYMENT_PATH ?? DEFAULT_TESTNET_DEPLOYMENT_PATH,
  fromBlock,
  toBlock,
}: {
  deploymentPath?: string;
  fromBlock?: bigint;
  toBlock?: bigint;
} = {}): Promise<TestnetMarketIndexResult> {
  const artifactPath = await resolveExistingDeploymentPath(deploymentPath);
  const deployment = await readTestnetDeployment(artifactPath);
  const indexFromBlock = fromBlock ?? testnetIndexFromBlock(deployment);
  const client = createPublicClient({
    chain: {
      id: deployment.chain.id,
      name: deployment.chain.name,
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: {
        default: { http: [deployment.chain.rpcUrl] },
      },
    },
    transport: http(deployment.chain.rpcUrl),
  });

  const latestBlock = toBlock ?? await client.getBlockNumber();
  const blockRange = testnetIndexBlockRange();
  const events: MarketCreatedEventLike[] = [];
  let cursor = indexFromBlock;

  while (cursor <= latestBlock) {
    const chunkToBlock = cursor + blockRange > latestBlock ? latestBlock : cursor + blockRange;
    events.push(
      ...(await client.getContractEvents({
        address: deployment.contracts.iknowMarketFactory.address as Address,
        abi: marketCreatedAbi,
        eventName: "MarketCreated",
        fromBlock: cursor,
        toBlock: chunkToBlock,
      })),
    );
    cursor = chunkToBlock + 1n;
  }

  const result = indexTestnetMarketCreatedEvents(deployment, events);

  await writeFile(artifactPath, `${JSON.stringify(result.deployment, null, 2)}\n`);

  return result;
}

export async function upsertTestnetDeploymentMarket(
  marketInput: unknown,
  deploymentPath = process.env.IKNOW_TESTNET_DEPLOYMENT_PATH ?? DEFAULT_TESTNET_DEPLOYMENT_PATH,
): Promise<TestnetDeployment> {
  return upsertTestnetDeploymentMarkets([marketInput], deploymentPath);
}

export async function upsertTestnetDeploymentMarkets(
  marketInputs: unknown[],
  deploymentPath = process.env.IKNOW_TESTNET_DEPLOYMENT_PATH ?? DEFAULT_TESTNET_DEPLOYMENT_PATH,
): Promise<TestnetDeployment> {
  if (marketInputs.length === 0) {
    return readTestnetDeployment(deploymentPath);
  }

  const nextMarkets = marketInputs.map((marketInput) => deployedMarketSchema.parse(marketInput));
  const artifactPath = await resolveExistingDeploymentPath(deploymentPath);
  const deployment = await readTestnetDeployment(artifactPath);
  const markets = nextMarkets.reduce(
    (currentMarkets, market) => [market, ...currentMarkets.filter((candidate) => !sameMarketRecord(candidate, market))],
    deployment.markets,
  );
  const nextDeployment = testnetDeploymentSchema.parse({ ...deployment, markets });

  await writeFile(artifactPath, `${JSON.stringify(nextDeployment, null, 2)}\n`);

  return nextDeployment;
}

export function indexTestnetMarketCreatedEvents(
  deployment: TestnetDeployment,
  events: readonly MarketCreatedEventLike[],
): TestnetMarketIndexResult {
  const existingByAddress = new Map(deployment.markets.map((market) => [market.address.toLowerCase(), market]));
  const eventMarketsByAddress = new Map<string, DeployedMarket>();
  let updated = 0;

  for (const event of events) {
    const existing = existingByAddress.get(requiredEventAddress(event).toLowerCase());
    const eventMarket = marketFromMarketCreatedEvent(event, existing);

    if (existing && marketRecordsDiffer(existing, eventMarket)) {
      updated += 1;
    }

    eventMarketsByAddress.set(eventMarket.address.toLowerCase(), eventMarket);
  }

  const eventMarkets = [...eventMarketsByAddress.values()].sort((a, b) => b.closeTime - a.closeTime);
  const eventMarketAddresses = new Set(eventMarkets.map((market) => market.address.toLowerCase()));
  const unchangedMarkets = deployment.markets.filter((market) => !eventMarketAddresses.has(market.address.toLowerCase()));
  const nextDeployment = testnetDeploymentSchema.parse({ ...deployment, markets: [...eventMarkets, ...unchangedMarkets] });

  return {
    deployment: nextDeployment,
    indexed: events.length,
    added: eventMarkets.filter((market) => !existingByAddress.has(market.address.toLowerCase())).length,
    updated,
  };
}

export function marketFromMarketCreatedEvent(event: MarketCreatedEventLike, existing?: DeployedMarket): DeployedMarket {
  const args = event.args;
  const market = requireEventArg(args.market, "market");
  const specHash = requireEventArg(args.specHash, "specHash");
  const metadataURI = requireEventArg(args.metadataURI, "metadataURI");
  const closeTime = requireEventArg(args.closeTime, "closeTime");
  const creationBond = requireEventArg(args.creationBond, "creationBond");
  const initialLiquidity = requireEventArg(args.initialLiquidity, "initialLiquidity");
  const address = getAddress(market);
  const idFragment = address.slice(-8).toLowerCase();
  const displayAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return deployedMarketSchema.parse({
    id: existing?.id ?? `arc-${idFragment}`,
    address,
    specHash,
    metadataURI,
    question: existing?.question ?? `Indexed Arc testnet market ${displayAddress}`,
    closeTime: Number(closeTime),
    resolutionSource:
      existing?.resolutionSource ??
      `Indexed from the Arc testnet MarketCreated event${event.transactionHash ? ` ${event.transactionHash}` : ""}.`,
    invalidConditions: existing?.invalidConditions ?? [],
    imageUrl: existing?.imageUrl,
    sourceIdea: existing?.sourceIdea,
    importReview: existing?.importReview,
    creationBond: creationBond.toString(),
    initialLiquidity: initialLiquidity.toString(),
    yesTokenId: outcomeTokenId(address, 0),
    noTokenId: outcomeTokenId(address, 1),
  });
}

export async function replaceTestnetDeploymentMarkets(
  marketInputs: unknown[],
  deploymentPath = process.env.IKNOW_TESTNET_DEPLOYMENT_PATH ?? DEFAULT_TESTNET_DEPLOYMENT_PATH,
): Promise<TestnetDeployment> {
  const markets = marketInputs.map((marketInput) => deployedMarketSchema.parse(marketInput));
  const artifactPath = await resolveExistingDeploymentPath(deploymentPath);
  const deployment = await readTestnetDeployment(artifactPath);
  const nextDeployment = testnetDeploymentSchema.parse({ ...deployment, markets });

  await writeFile(artifactPath, `${JSON.stringify(nextDeployment, null, 2)}\n`);

  return nextDeployment;
}

function deploymentPathCandidates(deploymentPath: string) {
  return path.isAbsolute(deploymentPath)
    ? [deploymentPath]
    : [path.resolve(process.cwd(), deploymentPath), path.resolve(process.cwd(), "../..", deploymentPath)];
}

async function resolveExistingDeploymentPath(deploymentPath: string) {
  let lastError: unknown;

  for (const candidate of deploymentPathCandidates(deploymentPath)) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Unable to read ${deploymentPath}`);
}

function testnetIndexFromBlock(deployment: TestnetDeployment) {
  const raw = process.env.IKNOW_TESTNET_INDEX_FROM_BLOCK;
  return raw ? BigInt(raw) : BigInt(deployment.contracts.iknowMarketFactory.indexStartBlock ?? 0);
}

function testnetIndexBlockRange() {
  const raw = process.env.IKNOW_TESTNET_INDEX_BLOCK_RANGE;
  return raw ? BigInt(raw) : 9_999n;
}

function requiredEventAddress(event: MarketCreatedEventLike) {
  return requireEventArg(event.args.market, "market");
}

function requireEventArg<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`MarketCreated event missing ${name}`);
  }
  return value;
}

function outcomeTokenId(market: Address, outcome: 0 | 1) {
  return BigInt(keccak256(encodePacked(["address", "uint8"], [market, outcome]))).toString();
}

function marketRecordsDiffer(a: DeployedMarket, b: DeployedMarket) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function sameMarketRecord(a: DeployedMarket, b: DeployedMarket) {
  return a.address.toLowerCase() === b.address.toLowerCase() || a.id === b.id;
}
