# iknow App MVP Plan

## Direction

The App MVP should prove the full prediction-market loop locally before we spend time on polish or public deployment.

For this phase, the app is a functional trading console:

- create markets
- browse markets
- inspect a market
- buy and sell YES/NO
- add and remove liquidity
- redeem after resolution
- claim fees and bonds where applicable

Visual identity is intentionally deferred to `docs/app-design.md`.

## Local-First Runtime

We can build and test the full app without Arc testnet or mainnet.

Local stack:

- Foundry `anvil` as the local blockchain RPC server
- Foundry scripts to deploy contracts
- `MockUSDC` for test collateral
- seeded demo markets
- deterministic local accounts for user simulation
- web app pointed at local contract addresses
- API/indexer pointed at the same local chain

This still uses real EVM transactions, but only against a disposable local chain.

## Local Wallet Actors

The local demo should define named actors so every workflow can be tested repeatedly.

Recommended actor set:

- `Deployer`: deploys contracts and seeds demo data
- `Creator`: creates markets and earns creator fees
- `TraderYes`: buys YES positions
- `TraderNo`: buys NO positions
- `LiquidityProvider`: adds/removes liquidity and earns LP fees
- `Resolver`: closes and resolves markets
- `Protocol`: receives protocol fees and slashed bonds

Each actor should receive local ETH and mock USDC during seed.

The app can support these in two ways:

- normal wallet connection to Anvil accounts
- dev-only local actor selector for fast simulation

The actor selector must be local/dev only and must never be enabled for real deployments.

## Server-Layer Rules

Even while the UI is simple, the server/data layer should be strong from the start.

Rules:

- contracts remain the source of truth
- API validates user input before contract calls
- indexer derives fast read models from contract events
- generated ABIs are imported from `packages/abis`
- shared schemas live in `packages/shared`
- environment config is explicit and validated
- no UI path should hand-build contract args if API/shared code can canonicalize them
- local demo addresses should come from a generated deployment artifact
- all transaction flows need pending, success, and failure states

## Data Sources

Use the simplest source that keeps the app truthful.

| Data | MVP source | Later source |
| --- | --- | --- |
| Contract addresses | local deployment artifact | deployment registry/config |
| Market discovery | deployment artifact + indexer events | indexer/API |
| Market live state | direct contract reads | contract reads + indexed cache |
| Draft creation args | API `/markets/draft` | API + agent linting |
| User balances | direct contract reads | direct reads |
| Historical events | indexer | indexer |

## Routes

### `/`

Markets list.

Shows:

- market question
- status
- close time
- rough YES/NO price
- liquidity
- link to market detail

### `/markets/:market`

Market detail and action hub.

Shows:

- question and metadata
- close time
- resolution source
- current status
- YES/NO price
- pool inventory
- user YES/NO balances
- user LP position
- claimable fees/redeem state

Actions:

- buy YES
- buy NO
- sell YES
- sell NO
- add liquidity
- remove liquidity
- close/propose/finalize if valid
- redeem/claim if valid

### `/create`

Create market.

Flow:

1. user enters question, close time, source, invalid conditions, bond, liquidity
2. app calls `/markets/draft`
3. user reviews normalized draft
4. user approves USDC
5. user creates market through factory

### `/portfolio`

Connected wallet summary.

Shows:

- YES/NO positions
- LP shares
- claimable LP fees
- creator fees and bonds where relevant
- redeemable winnings
- links back to market detail pages

## Build Order

1. Define route map and read model.
2. Wire wallet, chain config, and generated ABIs.
3. Add local Anvil deploy/seed path with named actors.
4. Build market list and read-only market detail.
5. Implement create market flow.
6. Implement buy/sell YES/NO.
7. Implement LP add/remove liquidity.
8. Build portfolio.
9. Implement resolution, redeem, fee claim, and bond claim flows.
10. Add smoke tests and local demo docs.

## Non-Goals For This Phase

- final visual identity
- production indexer scalability
- real Arc deployment
- real USDC
- agent-driven evidence automation
- advanced analytics/charts
- mobile-perfect polish

Those become important after the local product loop works end to end.
