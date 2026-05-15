# iknow Vision

## One-Line Thesis

`iknow` is an Arc-native AMM prediction market factory where anyone can create fully collateralized YES/NO markets with USDC.

Short pitch:

> Create the market. Prove the outcome. Settle in USDC.

## What We Are Building

We are building a prediction market protocol with different ingredients:

- AMM instead of an order book.
- Arc-native USDC settlement and gas.
- Permissionless or semi-permissionless market creation.
- Creator-seeded liquidity.
- LP participation.
- Fully collateralized YES/NO outcome tokens.
- Agent-assisted market drafting and evidence collection.
- Transparent resolution and redemption.

`iknow` should stand as its own Arc-native protocol.

## Core Market Mechanic

Each binary market has two outcomes:

- `YES`
- `NO`

The clean collateral model:

```txt
1 USDC -> 1 YES + 1 NO
YES + NO -> 1 USDC
```

After resolution:

```txt
YES wins: YES redeems 1 USDC, NO redeems 0
NO wins: NO redeems 1 USDC, YES redeems 0
INVALID: optional 50/50 refund or complete-set unwind
```

This is the solvency invariant. The protocol should never owe more USDC than it has locked for outcome redemption.

## Why AMM

Polymarket uses a peer-to-peer order book. `iknow` starts with an AMM so a new market can be tradeable as soon as the creator seeds liquidity.

The creator deposits USDC. The market contract mints matched YES/NO complete sets and seeds the AMM. Traders can buy YES or NO from the pool. LPs can add more USDC-backed liquidity.

This gives a simpler hackathon MVP than a CLOB:

- easier to reason about
- easier to demo
- easier to launch a new market
- better fit for small community-created markets

## Creator Capital

Creator capital should be split conceptually:

1. **Creation bond**
   - Discourages spam.
   - Signals seriousness.
   - Can be slashed only for objective violations such as invalid market wording, abandoned resolution duties, or malicious behavior.

2. **Initial liquidity**
   - Seeds the AMM.
   - Creates immediate market depth.
   - Takes real market-making risk.

The UX may combine these in one creation flow, but the protocol and docs should keep the distinction clear.

## Participants

### Creator

Creates a market, defines rules, posts a bond, and optionally seeds liquidity.

### Trader

Buys or sells YES/NO exposure based on belief about the outcome.

### LP

Adds USDC-backed liquidity to the market AMM and earns trading fees, while taking inventory and adverse-selection risk.

### Resolver

Proposes or finalizes market outcomes according to the market rules.

### Agent

Assists with market creation and settlement evidence. The agent should not be the final unilateral oracle.

## Agent Role

The agent improves the market lifecycle:

- turns vague ideas into precise market specs
- checks deadlines, sources, timezone, and invalid conditions
- rejects ambiguous or unsafe markets
- suggests initial odds or liquidity parameters
- gathers evidence near resolution
- prepares a settlement packet
- explains the outcome recommendation

The core rule:

> AI may recommend. Contracts and authorized resolution flow decide.

## Arc And Circle Fit

Arc matters because the whole market lifecycle can be dollar-native:

- create market with USDC
- seed liquidity with USDC
- buy YES/NO with USDC
- pay fees in USDC
- pay gas in USDC
- redeem winnings in USDC

Circle and Arc tooling can support:

- App Kit for Bridge, Send, Swap, and Unified Balance
- Gateway/CCTP for bringing USDC into Arc
- Circle Wallets as a future embedded-wallet path
- Arc contracts as the settlement and market logic layer

## MVP Product Flow

1. Creator opens `Create Market`.
2. Creator enters a question, end time, and resolution source.
3. Agent rewrites the market into a precise spec.
4. Creator confirms the spec.
5. Creator deposits USDC for bond and initial liquidity.
6. Contract deploys or registers a binary market.
7. Traders buy YES/NO through the AMM.
8. LPs add/remove liquidity.
9. Market closes.
10. Agent gathers evidence and prepares a settlement packet.
11. Resolver proposes/finalizes the outcome.
12. Winning tokens redeem for USDC.

## MVP Scope

Build first:

- binary markets only
- USDC collateral only
- complete-set mint and merge
- custom YES/NO AMM
- create market
- buy/sell YES and NO
- add/remove liquidity
- resolve market
- redeem winnings
- basic market list/detail UI
- agent-assisted market drafting
- evidence packet generation

Defer:

- order book
- multi-outcome markets
- leverage
- autonomous final resolution
- complex disputes
- real mainnet launch
- advanced compliance systems
- complex cross-chain routing

## Tech Stack Direction

- Contracts: Solidity, Foundry, OpenZeppelin.
- Frontend: Vite, React, TypeScript, Tailwind.
- Wallet: wagmi, viem, RainbowKit.
- Funding UX: Arc App Kit.
- API: Hono TypeScript API.
- Indexing: Envio first, Goldsky as backup.
- Database: Supabase or Neon Postgres.
- Agent: OpenAI Agents SDK for TypeScript, with deterministic schema validation.

## Brand

Name: `iknow`

Tone: confident, short, slightly smug, but still trustworthy.

Possible tagline:

```txt
Markets for what you know.
```

Icon direction:

- lowercase `i` with a raised eyebrow
- minimal speech bubble with a smirk
- monochrome mark with USDC blue accent
- YES in green/lime, NO in coral/red

The product should feel fast, opinionated, and market-native, not like a generic dashboard.
