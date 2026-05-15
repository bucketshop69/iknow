# Local Chain

The app MVP uses a disposable Anvil chain with real contract transactions, deterministic local actors, MockUSDC collateral, and seeded demo markets.

## Run

Terminal 1:

```bash
pnpm chain:anvil
```

Terminal 2:

```bash
pnpm chain:deploy
```

The deploy script writes:

```txt
contracts/deployments/local-anvil.json
```

This artifact is the local source of contract addresses, named actor wallets, seeded market addresses, token IDs, and market creation inputs for app/API/indexer development.

## What Deploys

- `MockUSDC`
- `OutcomeToken`
- `IknowMarketFactory`
- 3 sample markets created by the deterministic `creator` wallet

The script also:

- transfers `OutcomeToken` ownership to the factory
- funds deterministic actor wallets with local ETH
- mints MockUSDC to creator, trader, and LP actors
- seeds the first market with YES/NO demo buys and LP liquidity

## Actors

The generated artifact includes local-only private keys for:

- `deployer`
- `creator`
- `traderYes`
- `traderNo`
- `liquidityProvider`
- `resolver`
- `protocol`

These keys are for Anvil development only. Never reuse them outside a disposable local chain.

## Configuration

Defaults:

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Deployer private key: Anvil account 0

Overrides:

```bash
LOCAL_ANVIL_PORT=9545 pnpm chain:anvil
LOCAL_RPC_URL=http://127.0.0.1:9545 pnpm chain:deploy
LOCAL_DEPLOYER_PRIVATE_KEY=0x... pnpm chain:deploy
```
