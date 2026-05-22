# iknow Wallet Product Spec

## Direction

The wallet experience should make `iknow` feel like a dollar-native Arc app, not a crypto setup flow.

Recommended direction:

- Use Circle Modular Wallets as the preferred consumer wallet path.
- Use Circle Gas Station for sponsored gas on core user actions.
- Keep Circle User-Controlled SCA wallets as the fallback if passkey-first onboarding is not acceptable.
- Use developer-controlled wallets only for platform actors such as resolver automation, protocol operations, or treasury workflows.
- Do not use developer-controlled wallets for ordinary user market funds.

The core product principle is:

```txt
Users own their USDC, positions, LP shares, creator fees, and redemption rights.
iknow helps them act, but does not custody their funds.
```

Circle Modular Wallets fit the product because iknow needs non-custodial user wallets, gasless or sponsored transactions, and a way to package multi-step actions like `approve + createMarket` or `approve + buyYes` into one user intent.

Relevant Circle references:

- [Circle Modular Wallets](https://developers.circle.com/wallets/modular)
- [Circle User-Controlled Wallets](https://developers.circle.com/wallets/user-controlled)
- [Circle Gas Station](https://developers.circle.com/wallets/gas-station)
- [Circle supported blockchains](https://developers.circle.com/wallets/supported-blockchains)

## Product Goals

Wallet integration should solve these user problems:

- A new user can get a wallet without already understanding wallets.
- A user can get Arc USDC into the app with a clear next step.
- A trader can buy or sell without thinking about native gas.
- A creator can fund a market with clear total USDC required.
- An LP can understand that liquidity is risky market making, not a fixed-yield deposit.
- A winning user can redeem without hunting through markets manually.
- The resolver can operate through a controlled platform wallet without exposing local demo keys.

## Current Product Boundary

The current app still has a local development wallet model:

- Local deterministic actors simulate creator, trader, LP, resolver, and protocol roles.
- The visible wallet connection is not yet the signer for core market actions.
- Create, trade, liquidity, resolution, redeem, and claim actions currently execute through local actor private keys.

That model should remain useful for local testing, but must not leak into non-local deployments.

Product requirement:

```txt
The local actor selector is dev-only. Real deployments must use real user wallets or platform wallets.
```

## Wallet Personas

### First-Time User

Goal: create or access a wallet, get USDC, and make one useful action.

Journey:

1. User opens iknow.
2. User creates or unlocks a Circle wallet.
3. App shows wallet address and Arc USDC balance.
4. If USDC is missing, app shows a clear `Add USDC` path.
5. User takes a first market action with sponsored gas where eligible.

Product notes:

- The app should talk in USDC, not in gas mechanics.
- Wallet setup should happen only when the user needs to act, not before browsing.
- Empty balance should feel recoverable, not like a dead end.

### Creator

Goal: create a market and seed it with enough USDC to be tradable.

Journey:

1. Creator picks or drafts a market.
2. App shows total required USDC: creation bond plus initial liquidity.
3. Creator reviews rules, invalid conditions, close time, and funding.
4. Creator confirms one `Create market` intent.
5. Under the hood, the app handles allowance and factory creation.
6. Creator later sees claimable creator fees and creation bond in portfolio.

Product notes:

- Use the terms `safety deposit` and `money to start the market` in user-facing UX.
- Keep technical details available but secondary.
- Creation should fail early if USDC balance is insufficient.

### Trader

Goal: take a YES or NO position with clear cost, output, fee, and downside.

Journey:

1. Trader opens a market.
2. Trader chooses YES or NO.
3. App shows USDC input, expected outcome tokens, fee, slippage, and max loss.
4. Trader confirms one trade intent.
5. Trader sees position in portfolio.
6. After resolution, trader redeems from the market or portfolio.

Product notes:

- Buy flows should feel like spending USDC for exposure.
- Sell flows should make the token approval requirement invisible where batching allows it.
- The user should understand that a wrong position can become worthless.

### Liquidity Provider

Goal: provide AMM liquidity and understand inventory risk.

Journey:

1. LP reviews market depth, current price, volume, fees, and risk.
2. LP enters USDC amount.
3. App shows estimated LP shares and pool impact.
4. LP confirms one add-liquidity intent.
5. LP sees LP shares and pending fees in portfolio.
6. LP can remove liquidity or claim post-resolution amounts when available.

Product notes:

- LP UX must not imply guaranteed yield.
- LPs need a plain warning that they can lose to price movement and resolution.
- LP controls can ship after basic creator/trader wallet flows if needed.

### Resolver And Platform Operator

Goal: propose and finalize market outcomes through controlled platform operations.

Journey:

1. Resolver service watches eligible closed markets.
2. Agent prepares an evidence packet.
3. Policy decides whether the market can be proposed automatically.
4. Platform wallet submits the proposal only when policy allows it.
5. Finalization happens after the challenge window when allowed.
6. Human review handles ambiguous or high-risk cases.

Product notes:

- Resolver wallets are platform wallets, not user wallets.
- Production resolver keys must not be local demo private keys.
- Resolver actions need audit logs, policy limits, and a manual override path.

## MVP Scope

MVP wallet integration should include:

- Circle consumer wallet creation or login.
- Arc Testnet support.
- Wallet address display.
- Arc USDC balance display.
- Portfolio keyed by actual wallet address.
- Sponsored gas for approved core actions.
- User-signed market creation.
- User-signed buy and sell.
- User-signed add liquidity and remove liquidity if scope permits.
- User-signed redeem and claim flows.
- Local actor selector hidden or disabled outside local development.
- Platform wallet strategy for resolver automation.

MVP can defer:

- Mainnet production launch.
- Full onramp polish.
- Cross-chain USDC bridging polish.
- Multi-wallet account linking.
- Batch claims across all markets.
- Session permissions or delegated user trading.
- Advanced recovery education.
- Advanced LP analytics.
- Compliance automation beyond the agreed testnet boundary.

## Core Transaction Intents

The product should model actions as user intents, even when the chain requires multiple calls.

| Intent | Likely chain work | User-facing expectation |
| --- | --- | --- |
| Create market | USDC approval plus factory `createMarket` | One clear create confirmation |
| Buy YES/NO | USDC approval plus market buy | One clear trade confirmation |
| Sell YES/NO | Outcome-token operator approval plus market sell | One clear sell confirmation |
| Add liquidity | USDC approval plus `addLiquidity` | One clear liquidity confirmation |
| Remove liquidity | `removeLiquidity` | One clear withdrawal confirmation |
| Redeem | `redeem` | One clear redeem confirmation |
| Claim fees/bond | Claim call | One clear claim confirmation |
| Propose resolution | Platform wallet proposal | Not a normal user action |
| Finalize resolution | Platform or permissioned wallet finalization | Not a normal user action |

Where Circle Modular Wallet batching is available, the UI should present one intent and avoid separate approval prompts.

If batching is not available for a given path, the UI should still explain the action as one flow with clear progress states.

## Gas Sponsorship Policy

Gas sponsorship should be treated as a product feature with limits.

Sponsor by default:

- Wallet creation or deployment when required.
- First successful trade.
- Market creation on testnet.
- Redeem and claim flows.
- Resolver platform actions.

Consider limits for:

- Repeated failed transactions.
- High-frequency trading.
- Very small trades that can be used for spam.
- New accounts with no USDC balance.
- Users or regions outside the allowed test population.

Open policy questions:

- What is the daily sponsored gas cap per wallet?
- Should market creation always be sponsored or only during testnet?
- Should LP actions be sponsored from day one?
- Should users ever pay gas in USDC directly instead of iknow sponsoring?

## Funding USDC

The biggest activation risk is not wallet creation; it is getting Arc USDC.

MVP requirement:

```txt
Every empty-wallet state must point to a specific Add USDC path.
```

For Arc Testnet, this may be a faucet, testnet funding instruction, or controlled internal distribution flow.

For later production, the product needs a real funding strategy:

- Circle-native funding.
- USDC bridge or CCTP path.
- Onramp partner.
- Transfer from another wallet.
- Internal test credits only for closed demos.

The product should not launch a consumer wallet flow without a concrete funding path.

## Custody And Trust

User funds:

- Held in user-owned Circle wallets.
- Used only when the user confirms an action.
- Not controlled by iknow.

Platform funds:

- Held in platform-controlled wallets or multisig-like infrastructure.
- Used for resolver, protocol, treasury, sponsorship, or operations.
- Protected with policies, audit logs, and limited permissions.

User-facing trust copy should be plain:

- You own this wallet.
- iknow cannot trade with your funds.
- You can lose money on market positions.
- Sponsored gas does not remove market risk.

## Compliance Boundary

Prediction markets can create regulatory and market-access risk.

Before any production-like launch, product must decide:

- Which regions are allowed.
- Whether users need account checks before trading or creating markets.
- Whether some market categories are blocked.
- Whether creators need stronger gates than traders.
- Whether resolver or market import features introduce additional restrictions.
- What sanctions or abuse-screening obligations apply.

For MVP testnet, the product can keep this as an explicit non-production boundary, but the UI and docs should not imply public production availability.

## Failure States

Wallet UX must handle these states deliberately:

- User cancels wallet creation.
- Passkey creation fails.
- Wallet exists but is locked.
- User is on the wrong chain.
- USDC balance is too low.
- Gas sponsorship is unavailable.
- Approval succeeds but action fails.
- Batched transaction partially fails or reverts.
- Resolver proposal is refused by policy.
- Redeem is unavailable because the market is unresolved.

Each failure should have one next action where possible.

## Product Decisions Before Engineering

The team should align on these before implementation:

- Is passkey-first acceptable for iknow's first wallet experience?
- Do we launch Circle-only first, or keep injected wallets as a parallel path?
- Which actions get sponsored gas?
- What are the sponsorship caps?
- What is the official Arc Testnet `Add USDC` path?
- What will the production `Add USDC` path be?
- Should approvals be exact amount, max amount, or batched per action?
- Are market creators gated differently from traders?
- Are LP actions part of wallet MVP or phase two?
- What platform actions use developer-controlled wallets?
- What recovery story do we promise in the first version?
- What compliance boundary is acceptable for a testnet beta?

## Rollout Plan

### 1. Product Alignment

Create and review the wallet UX decisions in this spec.

Output:

- Confirm primary wallet model.
- Confirm MVP action list.
- Confirm funding path.
- Confirm gas sponsorship policy.
- Confirm local-only boundary for dev actors.

### 2. UX Prototype

Design the wallet moments before coding the integration.

Screens:

- Browse without wallet.
- Connect or create wallet.
- Empty USDC balance.
- Add USDC.
- Create market funding review.
- Trade confirmation.
- Portfolio with positions, LP shares, claims, and redeemables.
- Resolver/admin status surface.

### 3. Technical Spike

Validate the core Circle assumptions on Arc Testnet.

Spike goals:

- Create or access a Circle Modular Wallet.
- Read Arc USDC balance.
- Send a sponsored transaction through Gas Station.
- Execute one `approve + action` path.
- Confirm portfolio readback by wallet address.

### 4. Internal Alpha

Add real-wallet execution behind a feature flag.

Requirements:

- Local actor flow remains available only in local development.
- Real wallet actions use actual connected wallet address.
- Errors are clear enough for internal testers.
- Gas sponsorship limits are visible to the team.

### 5. Closed Testnet Beta

Invite a small group to create and trade markets on Arc Testnet.

Beta goals:

- Validate funding.
- Validate transaction success rates.
- Validate user understanding of creator funding and trade risk.
- Validate resolver automation separately from user wallets.

### 6. Production Readiness

Do not move beyond testnet without:

- Compliance position.
- Funding/onramp plan.
- Monitoring and abuse limits.
- Support and recovery playbook.
- Resolver key-management policy.
- Removal of local actor UI from public builds.

## Recommendation

Proceed with this product stance:

```txt
Circle Modular Wallets + Gas Station for users.
Developer-controlled wallets only for platform operations.
User-Controlled SCA remains the fallback if passkey-first is rejected.
```

The next engineering step should be a technical spike, not a full integration.
