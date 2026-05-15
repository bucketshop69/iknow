# iknow contracts

Solidity protocol workspace for the Arc-native iknow prediction market MVP.

## Contracts

- `OutcomeToken`: ERC-1155-style YES/NO outcome token with market-scoped token IDs.
- `IknowMarketFactory`: deploys and seeds new binary markets.
- `IknowMarket`: USDC-backed complete sets, fixed-product YES/NO AMM, LP shares, close/resolution, and redemption.

## Model

- USDC is the collateral asset and uses 6-decimal base units.
- `1 USDC unit -> 1 YES + 1 NO`.
- `1 YES + 1 NO -> 1 USDC unit` before resolution.
- After resolution, the winning outcome redeems `1:1`; `INVALID` currently unwinds matched YES/NO complete sets.
- Trades charge `30 bps` total: `20 bps` to an LP-owned fee bucket, `5 bps` to the market creator, and `5 bps` to the protocol recipient.
- LP fee buckets are paid pro-rata when LP shares are removed. Creator fees are claimable only after non-INVALID resolution; INVALID forfeits unclaimed creator fees into the LP bucket.

## Test

Install Foundry, then run from this directory:

```bash
forge build
forge test -vvv
```

Or run from the repo root:

```bash
pnpm contracts:build
pnpm contracts:test
```

Current test coverage includes outcome token permissions, complete-set split/merge, factory creation, AMM buy/sell, split-fee accounting, LP fee removal, YES/NO redemption, INVALID complete-set unwind, resolution edge cases, and bounded fuzz accounting.

## Deployment Notes

Deploy order:

1. Deploy `OutcomeToken`.
2. Deploy `IknowMarketFactory` with USDC, `OutcomeToken`, resolver, and protocol fee recipient addresses.
3. Transfer `OutcomeToken` ownership to the factory so it can authorize each market as a minter.
4. Create markets through the factory.

Do not deploy this as production contracts yet. The next hardening step is invariant/fuzz coverage for AMM solvency, LP accounting, and resolution edge cases.
