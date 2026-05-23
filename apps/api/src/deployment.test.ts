import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DeployedMarket } from "@iknow/shared";
import {
  indexTestnetMarketCreatedEvents,
  marketFromMarketCreatedEvent,
  readLocalDeployment,
  readTestnetDeployment,
  type TestnetDeployment,
  upsertLocalDeploymentMarket,
  upsertTestnetDeploymentMarket,
} from "./deployment.js";

test("reads and validates local deployment artifact", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "iknow-deployment-"));
  const deploymentPath = path.join(dir, "local.json");

  await writeFile(
    deploymentPath,
    JSON.stringify({
      schemaVersion: 1,
      generatedAtBlockTimestamp: 1_778_852_642,
      chain: {
        id: 31337,
        name: "Anvil",
        rpcUrl: "http://127.0.0.1:8545",
      },
      contracts: {
        mockUSDC: {
          address: "0x0000000000000000000000000000000000000001",
          decimals: 6,
        },
        outcomeToken: {
          address: "0x0000000000000000000000000000000000000002",
        },
        iknowMarketFactory: {
          address: "0x0000000000000000000000000000000000000003",
        },
      },
      actors: {
        deployer: {
          address: "0x0000000000000000000000000000000000000004",
          privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
        },
        creator: {
          address: "0x0000000000000000000000000000000000000005",
          privateKey: "0x2222222222222222222222222222222222222222222222222222222222222222",
        },
        traderYes: {
          address: "0x0000000000000000000000000000000000000006",
          privateKey: "0x3333333333333333333333333333333333333333333333333333333333333333",
        },
        traderNo: {
          address: "0x0000000000000000000000000000000000000007",
          privateKey: "0x4444444444444444444444444444444444444444444444444444444444444444",
        },
        liquidityProvider: {
          address: "0x0000000000000000000000000000000000000008",
          privateKey: "0x5555555555555555555555555555555555555555555555555555555555555555",
        },
        resolver: {
          address: "0x0000000000000000000000000000000000000009",
          privateKey: "0x6666666666666666666666666666666666666666666666666666666666666666",
        },
        protocol: {
          address: "0x0000000000000000000000000000000000000010",
          privateKey: "0x7777777777777777777777777777777777777777777777777777777777777777",
        },
      },
      markets: [],
    }),
  );

  const deployment = await readLocalDeployment(deploymentPath);

  assert.equal(deployment.chain.id, 31337);
  assert.equal(deployment.actors.creator.address, "0x0000000000000000000000000000000000000005");
});

test("upserts created markets with source idea metadata", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "iknow-deployment-"));
  const deploymentPath = path.join(dir, "local.json");
  const baseDeployment = {
    schemaVersion: 1,
    generatedAtBlockTimestamp: 1_778_852_642,
    chain: {
      id: 31337,
      name: "Anvil",
      rpcUrl: "http://127.0.0.1:8545",
    },
    contracts: {
      mockUSDC: {
        address: "0x0000000000000000000000000000000000000001",
        decimals: 6,
      },
      outcomeToken: {
        address: "0x0000000000000000000000000000000000000002",
      },
      iknowMarketFactory: {
        address: "0x0000000000000000000000000000000000000003",
      },
    },
    actors: {
      deployer: {
        address: "0x0000000000000000000000000000000000000004",
        privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
      creator: {
        address: "0x0000000000000000000000000000000000000005",
        privateKey: "0x2222222222222222222222222222222222222222222222222222222222222222",
      },
      traderYes: {
        address: "0x0000000000000000000000000000000000000006",
        privateKey: "0x3333333333333333333333333333333333333333333333333333333333333333",
      },
      traderNo: {
        address: "0x0000000000000000000000000000000000000007",
        privateKey: "0x4444444444444444444444444444444444444444444444444444444444444444",
      },
      liquidityProvider: {
        address: "0x0000000000000000000000000000000000000008",
        privateKey: "0x5555555555555555555555555555555555555555555555555555555555555555",
      },
      resolver: {
        address: "0x0000000000000000000000000000000000000009",
        privateKey: "0x6666666666666666666666666666666666666666666666666666666666666666",
      },
      protocol: {
        address: "0x0000000000000000000000000000000000000010",
        privateKey: "0x7777777777777777777777777777777777777777777777777777777777777777",
      },
    },
    markets: [],
  };

  await writeFile(deploymentPath, JSON.stringify(baseDeployment));

  const deployment = await upsertLocalDeploymentMarket(
    {
      id: "btc-150k",
      address: "0x0000000000000000000000000000000000000011",
      specHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      metadataURI: "urn:iknow:market:btc-150k",
      question: "Will Bitcoin hit $150k by June 30, 2026?",
      closeTime: 1_783_000_000,
      resolutionSource: "External market details.",
      invalidConditions: ["External market cannot be checked."],
      imageUrl: "https://example.com/btc.png",
      sourceIdea: {
        provider: "polymarket",
        externalId: "573655",
        url: "https://polymarket.com/market/will-bitcoin-hit-150k",
        imageUrl: "https://example.com/btc.png",
        question: "Will Bitcoin hit $150k by June 30, 2026?",
        closeTime: "2026-07-01T04:00:00.000Z",
      },
      creationBond: "100000000",
      initialLiquidity: "1000000000",
      yesTokenId: "1",
      noTokenId: "2",
    },
    deploymentPath,
  );

  assert.equal(deployment.markets.length, 1);
  assert.equal(deployment.markets[0].sourceIdea?.provider, "polymarket");
  assert.equal(deployment.markets[0].sourceIdea?.externalId, "573655");
  assert.equal(deployment.markets[0].imageUrl, "https://example.com/btc.png");
});

test("reads and upserts Arc testnet deployment markets", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "iknow-testnet-deployment-"));
  const deploymentPath = path.join(dir, "arc-testnet.json");

  await writeFile(
    deploymentPath,
    JSON.stringify({
      schemaVersion: 1,
      generatedAtBlockTimestamp: 1_779_451_103,
      chain: {
        id: 5_042_002,
        name: "Arc Testnet",
        rpcUrl: "https://rpc.testnet.arc.network",
      },
      contracts: {
        usdc: {
          address: "0x3600000000000000000000000000000000000000",
          decimals: 6,
        },
        outcomeToken: {
          address: "0x0000000000000000000000000000000000000002",
        },
        iknowMarketFactory: {
          address: "0x0000000000000000000000000000000000000003",
          defaultChallengeWindow: 120,
        },
      },
      actors: {
        deployer: "0x0000000000000000000000000000000000000004",
        resolver: "0x0000000000000000000000000000000000000005",
        protocolFeeRecipient: "0x0000000000000000000000000000000000000006",
      },
      markets: [],
    }),
  );

  const initialDeployment = await readTestnetDeployment(deploymentPath);

  assert.equal(initialDeployment.chain.id, 5_042_002);
  assert.equal(initialDeployment.contracts.usdc.decimals, 6);

  const deployment = await upsertTestnetDeploymentMarket(
    {
      id: "arc-btc-150k",
      address: "0x0000000000000000000000000000000000000011",
      specHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      metadataURI: "urn:iknow:market:arc-btc-150k",
      question: "Will Bitcoin hit $150k by June 30, 2026?",
      closeTime: 1_783_000_000,
      resolutionSource: "External market details.",
      invalidConditions: ["External market cannot be checked."],
      creationBond: "5000000",
      initialLiquidity: "10000000",
      yesTokenId: "1",
      noTokenId: "2",
    },
    deploymentPath,
  );

  assert.equal(deployment.markets.length, 1);
  assert.equal(deployment.markets[0].id, "arc-btc-150k");
});

test("normalizes Arc MarketCreated events into deployment market records", () => {
  const market = marketFromMarketCreatedEvent({
    args: {
      market: "0x00000000000000000000000000000000000000aa",
      creator: "0x00000000000000000000000000000000000000bb",
      specHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      metadataURI: "urn:iknow:market:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      closeTime: 1_783_000_000n,
      creationBond: 5_000_000n,
      initialLiquidity: 10_000_000n,
    },
    transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });

  assert.equal(market.id, "arc-000000aa");
  assert.equal(market.address, "0x00000000000000000000000000000000000000AA");
  assert.equal(market.question, "Indexed Arc testnet market 0x0000...00AA");
  assert.equal(market.creationBond, "5000000");
  assert.equal(market.initialLiquidity, "10000000");
  assert.match(market.yesTokenId, /^\d+$/);
  assert.match(market.noTokenId, /^\d+$/);
  assert.notEqual(market.yesTokenId, market.noTokenId);
});

test("indexes Arc MarketCreated events while preserving rich existing metadata", () => {
  const existingMarket: DeployedMarket = {
    id: "rich-market",
    address: "0x00000000000000000000000000000000000000AA",
    specHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    metadataURI: "urn:iknow:market:rich",
    question: "Will Bitcoin hit $150k by June 30, 2026?",
    closeTime: 1_783_000_000,
    resolutionSource: "Binance BTC/USDT high price.",
    invalidConditions: ["Wrong exchange."],
    imageUrl: "https://example.com/btc.png",
    sourceIdea: {
      provider: "market-source",
      externalId: "btc-150k",
      question: "Will Bitcoin hit $150k by June 30, 2026?",
      closeTime: "2026-07-01T04:00:00.000Z",
    },
    importReview: {
      status: "ready",
      resolverMode: "autonomous",
      resolverTemplate: "general-agent",
      score: 9,
      blockers: [],
      warnings: [],
      rewrittenResolutionSource: "Agents check Binance BTC/USDT high price.",
      rewrittenInvalidConditions: ["Wrong exchange."],
      evidencePlan: ["Read Binance candles."],
      requiredCapabilities: ["Public price lookup"],
      missingCapabilities: [],
      reviewerReports: [
        {
          role: "policy",
          score: 9,
          verdict: "pass",
          reasons: ["Resolution path is objective."],
        },
      ],
      reviewPolicyVersion: "market-import-review-llm-v1",
    },
    creationBond: "5000000",
    initialLiquidity: "10000000",
    yesTokenId: "1",
    noTokenId: "2",
  };
  const deployment: TestnetDeployment = {
    schemaVersion: 1,
    generatedAtBlockTimestamp: 1_779_451_103,
    chain: {
      id: 5_042_002,
      name: "Arc Testnet",
      rpcUrl: "https://rpc.testnet.arc.network",
    },
    contracts: {
      usdc: {
        address: "0x3600000000000000000000000000000000000000",
        decimals: 6,
      },
      outcomeToken: {
        address: "0x0000000000000000000000000000000000000002",
      },
      iknowMarketFactory: {
        address: "0x0000000000000000000000000000000000000003",
        defaultChallengeWindow: 120,
      },
    },
    actors: {},
    markets: [existingMarket],
  };

  const result = indexTestnetMarketCreatedEvents(deployment, [
    {
      args: {
        market: "0x00000000000000000000000000000000000000aa",
        creator: "0x00000000000000000000000000000000000000bb",
        specHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        metadataURI: "urn:iknow:market:rich",
        closeTime: 1_783_000_000n,
        creationBond: 5_000_000n,
        initialLiquidity: 10_000_000n,
      },
      blockNumber: 10n,
      logIndex: 0,
    },
    {
      args: {
        market: "0x00000000000000000000000000000000000000cc",
        creator: "0x00000000000000000000000000000000000000bb",
        specHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        metadataURI: "urn:iknow:market:indexed-only",
        closeTime: 1_784_000_000n,
        creationBond: 5_000_000n,
        initialLiquidity: 10_000_000n,
      },
      blockNumber: 11n,
      logIndex: 0,
    },
  ]);

  assert.equal(result.indexed, 2);
  assert.equal(result.added, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.deployment.markets.length, 2);
  assert.equal(result.deployment.markets[1].id, "rich-market");
  assert.equal(result.deployment.markets[1].question, "Will Bitcoin hit $150k by June 30, 2026?");
  assert.equal(result.deployment.markets[1].imageUrl, "https://example.com/btc.png");
  assert.equal(result.deployment.markets[1].importReview?.reviewPolicyVersion, "market-import-review-llm-v1");
  assert.equal(result.deployment.markets[0].id, "arc-000000cc");
});
