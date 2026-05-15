# iknow

AMM prediction market factory on Arc.

`iknow` lets creators launch fully collateralized YES/NO markets with USDC, seed AMM liquidity, and let traders/LPs participate through Arc-native settlement.

## Workspace

```txt
contracts/        Solidity + Foundry
apps/web/         Vite + React + TypeScript
apps/api/         Hono + TypeScript
apps/indexer/     Envio indexer placeholder
packages/shared/  Shared schemas and constants
packages/abis/    Generated/exported contract ABIs
docs/             Product and protocol notes
```

## Scripts

```bash
pnpm install
pnpm dev:web
pnpm dev:api
pnpm build
pnpm typecheck
```

Foundry scripts require `forge`:

```bash
pnpm contracts:build
pnpm contracts:test
pnpm chain:anvil
pnpm chain:deploy
```

`pnpm chain:deploy` writes the local deployment artifact to `contracts/deployments/local-anvil.json`.
See [docs/local-chain.md](docs/local-chain.md) for the Anvil actor, deploy, and seed flow.

## Vision

See [docs/vision.md](docs/vision.md).

## App MVP

See [docs/app-mvp-plan.md](docs/app-mvp-plan.md) for the local-first app plan and [docs/app-design.md](docs/app-design.md) for deferred design notes.
