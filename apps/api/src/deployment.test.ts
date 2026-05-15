import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readLocalDeployment } from "./deployment.js";

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
