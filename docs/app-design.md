# iknow App Design Notes

## Current Priority

The App MVP is functional-first. We should make the product understandable, usable, and reliable before spending serious time on visual polish.

The product direction lives in `docs/vision.md`, and the local demo/deployment flow lives in `docs/local-chain.md`.

For now, design work should support these goals:

- users can understand what a market is
- users can connect a wallet and see their state
- users can create, trade, provide liquidity, redeem, and claim without confusion
- transaction states are clear
- errors are understandable
- demo flow is repeatable

## Deferred Decisions

These are intentionally not locked yet:

- brand color palette
- font family
- icon style beyond the temporary smug icon direction
- detailed spacing system
- final card/table/chart styling
- animation and motion language
- landing page or marketing treatment

We will revisit these once the App MVP flows are wired and the product surface is real enough to judge.

## Temporary UI Direction

Until then, the app should use a restrained builder-dashboard style:

- simple layout
- readable text
- clear primary actions
- obvious wallet and chain state
- practical tables/forms
- minimal decoration
- no heavy hero/marketing treatment

The first useful design milestone is not "make it beautiful"; it is "make every core action obvious and hard to misuse."

## Core Screens

- Markets list
- Market detail
- Create market
- Trade YES/NO
- Add/remove liquidity
- Portfolio
- Resolve/redeem/claim actions

## Later Brand Thread

The working product name is `iknow`. The icon direction is a smug mark, but exact treatment is open.

When we return to visual identity, decide:

- logo/icon
- typeface
- color palette
- market status colors
- probability/price chart style
- empty/loading/error visual language
