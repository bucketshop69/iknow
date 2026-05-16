import { useEffect, useMemo, useState } from "react";
import type { DeployedMarket, LocalDeployment, MarketDraftResponse } from "@iknow/shared";
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";
import {
  apiBaseUrl,
  contractSurface,
  createMarketDataSource,
  devActorsFromDeployment,
  loadLocalDeployment,
  type ResolutionOutcomeInput,
  type TradeAction,
  type TradeQuoteReadback,
} from "./data";
import type {
  CreateDraftInput,
  DevActor,
  MarketLifecycleReadback,
  MarketUserState,
  MarketReadModel,
  PortfolioReadModel,
  Route,
} from "./types";

const initialRoute = (): Route => {
  const path = window.location.pathname;

  if (path === "/create") {
    return { screen: "create" };
  }

  if (path === "/portfolio") {
    return { screen: "portfolio" };
  }

  const marketMatch = path.match(/^\/markets\/([^/]+)$/);
  if (marketMatch) {
    return { screen: "market", marketId: decodeURIComponent(marketMatch[1]) };
  }

  return { screen: "markets" };
};

const routePath = (route: Route) => {
  if (route.screen === "create") {
    return "/create";
  }

  if (route.screen === "portfolio") {
    return "/portfolio";
  }

  if (route.screen === "market") {
    return `/markets/${encodeURIComponent(route.marketId)}`;
  }

  return "/";
};

const shortAddress = (address?: string) =>
  address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not deployed";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const toDateTimeLocal = (date: Date) => {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

function App() {
  const [route, setRoute] = useState<Route>(initialRoute);
  const [deployment, setDeployment] = useState<LocalDeployment | null>(null);
  const [deploymentState, setDeploymentState] = useState<"loading" | "ready" | "fallback">("loading");
  const actors = useMemo(() => devActorsFromDeployment(deployment), [deployment]);
  const [actorId, setActorId] = useState("traderYes");
  const surface = useMemo(() => contractSurface(deployment), [deployment]);
  const dataSource = useMemo(() => createMarketDataSource(deployment, actors), [deployment, actors]);
  const markets = dataSource.listMarkets();
  const actor = actors.find((candidate) => candidate.id === actorId) ?? actors[0];
  const [chainRefreshKey, setChainRefreshKey] = useState(0);

  const refreshDeployment = async () => {
    setDeploymentState("loading");
    try {
      const nextDeployment = await loadLocalDeployment();
      setDeployment(nextDeployment);
      setDeploymentState(nextDeployment ? "ready" : "fallback");
    } catch {
      setDeploymentState("fallback");
    }
  };

  const refreshChainReadbacks = () => {
    setChainRefreshKey((current) => current + 1);
    void refreshDeployment();
  };

  useEffect(() => {
    const syncRoute = () => setRoute(initialRoute());
    window.addEventListener("popstate", syncRoute);

    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadLocalDeployment()
      .then((nextDeployment) => {
        if (cancelled) {
          return;
        }
        setDeployment(nextDeployment);
        setDeploymentState(nextDeployment ? "ready" : "fallback");
      })
      .catch(() => {
        if (!cancelled) {
          setDeploymentState("fallback");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const addCreatedMarket = (market: DeployedMarket) => {
    setDeployment((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        markets: [market, ...current.markets.filter((candidate) => candidate.address !== market.address)],
      };
    });
    navigate({ screen: "market", marketId: market.id });
  };

  const navigate = (nextRoute: Route) => {
    setRoute(nextRoute);
    window.history.pushState(null, "", routePath(nextRoute));
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <strong>iknow</strong>
          <span>App MVP</span>
        </div>
        <nav aria-label="Primary">
          <button
            className={route.screen === "markets" || route.screen === "market" ? "active" : ""}
            onClick={() => navigate({ screen: "markets" })}
          >
            Markets
          </button>
          <button
            className={route.screen === "create" ? "active" : ""}
            onClick={() => navigate({ screen: "create" })}
          >
            Create
          </button>
          <button
            className={route.screen === "portfolio" ? "active" : ""}
            onClick={() => navigate({ screen: "portfolio" })}
          >
            Portfolio
          </button>
        </nav>
        <WalletPanel actor={actor} actorId={actorId} actors={actors} onActorChange={setActorId} />
        <WalletConnectionPanel />
        <RuntimePanel surface={surface} state={deploymentState} onRefresh={refreshChainReadbacks} />
      </aside>

      <main className="workspace">
        {route.screen === "markets" && (
          <MarketsScreen markets={markets} onOpenMarket={(marketId) => navigate({ screen: "market", marketId })} />
        )}
        {route.screen === "market" && (
          <MarketDetailScreen
            market={dataSource.getMarket(route.marketId)}
            actorId={actorId}
            dataSource={dataSource}
            refreshKey={chainRefreshKey}
            onTransactionConfirmed={refreshChainReadbacks}
            onBack={() => navigate({ screen: "markets" })}
          />
        )}
        {route.screen === "create" && (
          <CreateScreen actorId={actorId} dataSource={dataSource} onMarketCreated={addCreatedMarket} />
        )}
        {route.screen === "portfolio" && (
          <PortfolioScreen
            actorId={actorId}
            dataSource={dataSource}
            refreshKey={chainRefreshKey}
            onOpenMarket={(marketId) => navigate({ screen: "market", marketId })}
          />
        )}
      </main>
    </div>
  );
}

function WalletPanel({
  actor,
  actorId,
  actors,
  onActorChange,
}: {
  actor: DevActor;
  actorId: string;
  actors: DevActor[];
  onActorChange: (actorId: string) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">Local actor</div>
      <label>
        Actor
        <select value={actorId} onChange={(event) => onActorChange(event.target.value)}>
          {actors.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
      <dl className="compact-list">
        <div>
          <dt>Role</dt>
          <dd>{actor.role}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{shortAddress(actor.address)}</dd>
        </div>
        <div>
          <dt>USDC</dt>
          <dd>{actor.usdcBalance}</dd>
        </div>
      </dl>
    </section>
  );
}

function WalletConnectionPanel() {
  const account = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const injectedConnector = connectors[0];

  return (
    <section className="panel">
      <div className="panel-title">Wallet</div>
      <dl className="compact-list">
        <div>
          <dt>Status</dt>
          <dd>{account.isConnected ? "Connected" : "Not connected"}</dd>
        </div>
        <div>
          <dt>Account</dt>
          <dd>{shortAddress(account.address)}</dd>
        </div>
        <div>
          <dt>Chain id</dt>
          <dd>{chainId}</dd>
        </div>
      </dl>
      {account.isConnected ? (
        <button className="secondary" onClick={() => disconnect()}>
          Disconnect
        </button>
      ) : (
        <button disabled={!injectedConnector || isPending} onClick={() => injectedConnector && connect({ connector: injectedConnector })}>
          {isPending ? "Connecting..." : "Connect wallet"}
        </button>
      )}
      {error && <p className="error-text">{error.message}</p>}
    </section>
  );
}

function RuntimePanel({
  surface,
  state,
  onRefresh,
}: {
  surface: ReturnType<typeof contractSurface>;
  state: string;
  onRefresh: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">Runtime</div>
      <dl className="compact-list">
        <div>
          <dt>Deployment</dt>
          <dd>{state === "ready" ? "Local artifact loaded" : state === "loading" ? "Loading" : `Fallback (${apiBaseUrl})`}</dd>
        </div>
        <div>
          <dt>Chain</dt>
          <dd>{surface.chainName}</dd>
        </div>
        <div>
          <dt>Factory</dt>
          <dd>{shortAddress(surface.marketFactory)}</dd>
        </div>
        <div>
          <dt>Outcome token</dt>
          <dd>{shortAddress(surface.outcomeToken)}</dd>
        </div>
        <div>
          <dt>ABI functions</dt>
          <dd>
            {surface.abiSummary.factoryFunctions.length}/
            {surface.abiSummary.marketFunctions.length}/
            {surface.abiSummary.outcomeTokenFunctions.length}
          </dd>
        </div>
      </dl>
      <button className="secondary" onClick={onRefresh}>
        Refresh deployment
      </button>
    </section>
  );
}

function MarketsScreen({
  markets,
  onOpenMarket,
}: {
  markets: MarketReadModel[];
  onOpenMarket: (marketId: string) => void;
}) {
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Markets</p>
          <h1>Prediction markets</h1>
        </div>
        <span className="count-pill">{markets.length} markets</span>
      </header>

      <section className="market-table" aria-label="Markets">
        <div className="market-row table-head">
          <span>Market</span>
          <span>Status</span>
          <span>YES</span>
          <span>NO</span>
          <span>Liquidity</span>
          <span />
        </div>
        {markets.map((market) => (
          <article className="market-row" key={market.id}>
            <div>
              <h2>{market.question}</h2>
              <p>Closes {formatDate(market.closeTime)}</p>
            </div>
            <span className="status">{market.status}</span>
            <strong>{Math.round(market.yesPrice * 100)}¢</strong>
            <strong>{Math.round(market.noPrice * 100)}¢</strong>
            <span>{market.liquidity}</span>
            <button className="secondary" onClick={() => onOpenMarket(market.id)}>
              Open
            </button>
          </article>
        ))}
      </section>
    </>
  );
}

function MarketDetailScreen({
  market,
  actorId,
  dataSource,
  refreshKey,
  onTransactionConfirmed,
  onBack,
}: {
  market?: MarketReadModel;
  actorId: string;
  dataSource: ReturnType<typeof createMarketDataSource>;
  refreshKey: number;
  onTransactionConfirmed: () => void;
  onBack: () => void;
}) {
  if (!market) {
    return (
      <section className="empty-state">
        <h1>Market not found</h1>
        <button onClick={onBack}>Back to markets</button>
      </section>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Market detail</p>
          <h1>{market.question}</h1>
        </div>
        <button className="secondary" onClick={onBack}>
          Back
        </button>
      </header>

      <section className="detail-grid">
        <article className="wide-card">
          <div className="metric-grid">
            <Metric label="Status" value={market.status} />
            <Metric label="Close time" value={formatDate(market.closeTime)} />
            <Metric label="YES price" value={`${Math.round(market.yesPrice * 100)}¢`} />
            <Metric label="NO price" value={`${Math.round(market.noPrice * 100)}¢`} />
            <Metric label="Liquidity" value={market.liquidity} />
            <Metric label="24h volume" value={market.volume24h} />
          </div>
        </article>

        <article>
          <h2>Pool</h2>
          <dl className="compact-list">
            <div>
              <dt>YES reserve</dt>
              <dd>{market.yesReserve}</dd>
            </div>
            <div>
              <dt>NO reserve</dt>
              <dd>{market.noReserve}</dd>
            </div>
            <div>
              <dt>Market address</dt>
              <dd>{shortAddress(market.address)}</dd>
            </div>
            <div>
              <dt>Spec hash</dt>
              <dd>{shortAddress(market.specHash)}</dd>
            </div>
          </dl>
        </article>

        <article>
          <h2>Resolution</h2>
          <p>{market.resolutionSource}</p>
          <ul className="plain-list">
            {market.invalidConditions.map((condition) => (
              <li key={condition}>{condition}</li>
            ))}
          </ul>
        </article>

        <MarketActionPanel
          actorId={actorId}
          market={market}
          dataSource={dataSource}
          refreshKey={refreshKey}
          onTransactionConfirmed={onTransactionConfirmed}
        />
      </section>
    </>
  );
}

function MarketActionPanel({
  actorId,
  market,
  dataSource,
  refreshKey,
  onTransactionConfirmed,
}: {
  actorId: string;
  market: MarketReadModel;
  dataSource: ReturnType<typeof createMarketDataSource>;
  refreshKey: number;
  onTransactionConfirmed: () => void;
}) {
  const [tradeAmount, setTradeAmount] = useState("25");
  const [tradeAction, setTradeAction] = useState<TradeAction>("BUY_YES");
  const [slippageBps, setSlippageBps] = useState(100);
  const [tradeQuote, setTradeQuote] = useState<TradeQuoteReadback | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<string | null>(null);
  const [liquidityAmount, setLiquidityAmount] = useState("100");
  const [removeShares, setRemoveShares] = useState("100");
  const [status, setStatus] = useState<string | null>(null);
  const [userState, setUserState] = useState<MarketUserState | null>(null);
  const [lifecycle, setLifecycle] = useState<MarketLifecycleReadback | null>(null);
  const [readbackStatus, setReadbackStatus] = useState<string | null>(null);
  const [resolutionOutcome, setResolutionOutcome] = useState<ResolutionOutcomeInput>("YES");
  const [evidenceURI, setEvidenceURI] = useState("local://evidence/manual-resolution");

  useEffect(() => {
    let cancelled = false;

    setReadbackStatus("Refreshing position...");
    Promise.all([
      dataSource.readMarketUserState(actorId, market.id),
      dataSource.readMarketLifecycle(actorId, market.id),
    ])
      .then(([nextUserState, nextLifecycle]) => {
        if (cancelled) {
          return;
        }
        setUserState(nextUserState);
        setLifecycle(nextLifecycle);
        setReadbackStatus(null);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setUserState(null);
        setLifecycle(null);
        setReadbackStatus(caught instanceof Error ? caught.message : "Position readback unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [actorId, dataSource, market.id, refreshKey]);

  useEffect(() => {
    let cancelled = false;

    setTradeQuote(null);
    if (!tradeAmount.trim()) {
      setQuoteStatus(null);
      return () => {
        cancelled = true;
      };
    }

    setQuoteStatus("Refreshing quote...");
    dataSource
      .buildTradeQuote(market.id, tradeAction, tradeAmount, slippageBps)
      .then((quote) => {
        if (cancelled) {
          return;
        }
        setTradeQuote(quote);
        setQuoteStatus(null);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setTradeQuote(null);
        setQuoteStatus(caught instanceof Error ? caught.message : "Quote unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource, market.id, refreshKey, slippageBps, tradeAction, tradeAmount]);

  const runAction = async (label: string, action: () => Promise<string>) => {
    setStatus(`${label} pending...`);
    try {
      const hash = await action();
      setStatus(`${label} confirmed: ${shortAddress(hash)}`);
      onTransactionConfirmed();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : `${label} failed`);
    }
  };

  const isErrorStatus = (message: string) =>
    ["failed", "must", "not loaded", "unknown", "greater", "insufficient", "revert"].some((token) =>
      message.toLowerCase().includes(token),
    );

  const lifecycleStatus = lifecycle
    ? lifecycle.state === "Resolved"
      ? `Resolved ${lifecycle.finalOutcome}`
      : lifecycle.state === "Resolution proposed"
        ? `Proposed ${lifecycle.proposedOutcome}`
        : lifecycle.state
    : "Unavailable";
  const isOpenMarket = lifecycle?.state === "Open";

  const tradeLabel = (action: TradeAction) => {
    if (action === "BUY_YES") {
      return "Buy YES";
    }
    if (action === "BUY_NO") {
      return "Buy NO";
    }
    if (action === "SELL_YES") {
      return "Sell YES";
    }
    return "Sell NO";
  };

  const updateSlippage = (value: string) => {
    const nextPercent = Number(value);
    if (Number.isFinite(nextPercent)) {
      setSlippageBps(Math.max(0, Math.min(50, nextPercent)) * 100);
    }
  };

  const runTrade = (action: TradeAction) => {
    const side = action.endsWith("YES") ? "YES" : "NO";
    setTradeAction(action);

    return runAction(
      tradeLabel(action),
      () =>
        action.startsWith("BUY")
          ? dataSource.executeBuy(actorId, market.id, side, tradeAmount, slippageBps)
          : dataSource.executeSell(actorId, market.id, side, tradeAmount, slippageBps),
    );
  };

  return (
    <article className="wide-card">
      <h2>Local actions</h2>
      <dl className="compact-list">
        <div>
          <dt>Your YES</dt>
          <dd>{userState?.yesBalance ?? (readbackStatus ? "Unavailable" : "0 YES")}</dd>
        </div>
        <div>
          <dt>Your NO</dt>
          <dd>{userState?.noBalance ?? (readbackStatus ? "Unavailable" : "0 NO")}</dd>
        </div>
        <div>
          <dt>Your LP shares</dt>
          <dd>{userState?.lpShares ?? (readbackStatus ? "Unavailable" : "0 LP")}</dd>
        </div>
        <div>
          <dt>Pending LP fees</dt>
          <dd>{userState?.pendingLpFees ?? (readbackStatus ? "Unavailable" : "0 USDC")}</dd>
        </div>
        <div>
          <dt>Total LP shares</dt>
          <dd>{userState?.totalLpShares ?? (readbackStatus ? "Unavailable" : "0 LP")}</dd>
        </div>
        <div>
          <dt>Live reserves</dt>
          <dd>{userState ? `${userState.yesReserve} / ${userState.noReserve}` : readbackStatus ? "Unavailable" : "0 / 0"}</dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>{lifecycleStatus}</dd>
        </div>
        <div>
          <dt>Finalize after</dt>
          <dd>{lifecycle?.finalizeAfter ? formatDate(lifecycle.finalizeAfter) : "-"}</dd>
        </div>
      </dl>
      {readbackStatus && !userState && (
        <p className={readbackStatus.startsWith("Refreshing") ? "status-text" : "error-text"}>{readbackStatus}</p>
      )}
      <div className="action-grid">
        <label>
          Trade amount
          <input inputMode="decimal" value={tradeAmount} onChange={(event) => setTradeAmount(event.target.value)} />
        </label>
        <label>
          Quote
          <select value={tradeAction} onChange={(event) => setTradeAction(event.target.value as TradeAction)}>
            <option value="BUY_YES">Buy YES</option>
            <option value="BUY_NO">Buy NO</option>
            <option value="SELL_YES">Sell YES</option>
            <option value="SELL_NO">Sell NO</option>
          </select>
        </label>
        <label>
          Slippage %
          <input
            inputMode="decimal"
            value={String(slippageBps / 100)}
            onChange={(event) => updateSlippage(event.target.value)}
          />
        </label>
        <dl className="compact-list">
          <div>
            <dt>Input</dt>
            <dd>{tradeQuote?.inputLabel ?? "-"}</dd>
          </div>
          <div>
            <dt>Expected out</dt>
            <dd>{tradeQuote?.outputLabel ?? "-"}</dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd>{tradeQuote?.feeLabel ?? "-"}</dd>
          </div>
          <div>
            <dt>Min out</dt>
            <dd>{tradeQuote?.minOutputLabel ?? "-"}</dd>
          </div>
        </dl>
        {quoteStatus && (
          <p className={quoteStatus.startsWith("Refreshing") ? "status-text" : "error-text"}>{quoteStatus}</p>
        )}
        <div className="button-row">
          <button disabled={!isOpenMarket} onClick={() => runTrade("BUY_YES")}>
            Buy YES
          </button>
          <button disabled={!isOpenMarket} onClick={() => runTrade("BUY_NO")}>
            Buy NO
          </button>
          <button disabled={!isOpenMarket} onClick={() => runTrade("SELL_YES")}>
            Sell YES
          </button>
          <button disabled={!isOpenMarket} onClick={() => runTrade("SELL_NO")}>
            Sell NO
          </button>
        </div>
        <label>
          Liquidity amount
          <input
            inputMode="decimal"
            value={liquidityAmount}
            onChange={(event) => setLiquidityAmount(event.target.value)}
          />
        </label>
        <button
          className="secondary"
          disabled={!isOpenMarket}
          onClick={() => runAction("Add liquidity", () => dataSource.executeAddLiquidity(actorId, market.id, liquidityAmount))}
        >
          Add liquidity
        </button>
        <label>
          Remove LP shares
          <input inputMode="decimal" value={removeShares} onChange={(event) => setRemoveShares(event.target.value)} />
        </label>
        <button
          className="secondary"
          disabled={!isOpenMarket}
          onClick={() =>
            runAction("Remove liquidity", () => dataSource.executeRemoveLiquidity(actorId, market.id, removeShares))
          }
        >
          Remove liquidity
        </button>
        <label>
          Resolution outcome
          <select
            value={resolutionOutcome}
            onChange={(event) => setResolutionOutcome(event.target.value as ResolutionOutcomeInput)}
          >
            <option value="YES">YES</option>
            <option value="NO">NO</option>
            <option value="INVALID">INVALID</option>
          </select>
        </label>
        <label>
          Evidence URI
          <input value={evidenceURI} onChange={(event) => setEvidenceURI(event.target.value)} />
        </label>
        <div className="button-row lifecycle-actions">
          <button
            className="secondary"
            disabled={!lifecycle?.canClose}
            onClick={() => runAction("Close market", () => dataSource.executeCloseMarket(actorId, market.id))}
          >
            Close
          </button>
          <button
            className="secondary"
            disabled={!lifecycle?.canPropose}
            onClick={() =>
              runAction("Propose resolution", () =>
                dataSource.executeProposeResolution(actorId, market.id, resolutionOutcome, evidenceURI),
              )
            }
          >
            Propose
          </button>
          <button
            className="secondary"
            disabled={!lifecycle?.canFinalize}
            onClick={() => runAction("Finalize resolution", () => dataSource.executeFinalizeResolution(actorId, market.id))}
          >
            Finalize
          </button>
          <button
            className="secondary"
            disabled={!lifecycle?.canRedeem}
            onClick={() => runAction("Redeem", () => dataSource.executeRedeem(actorId, market.id))}
          >
            Redeem
          </button>
          <button
            className="secondary"
            disabled={!lifecycle?.canClaimCreatorFees}
            onClick={() => runAction("Claim creator fees", () => dataSource.executeClaimCreatorFees(actorId, market.id))}
          >
            Claim creator
          </button>
          <button
            className="secondary"
            disabled={!lifecycle?.canClaimProtocolFees}
            onClick={() => runAction("Claim protocol fees", () => dataSource.executeClaimProtocolFees(actorId, market.id))}
          >
            Claim protocol
          </button>
          <button
            className="secondary"
            disabled={!lifecycle?.canClaimCreationBond}
            onClick={() => runAction("Claim creation bond", () => dataSource.executeClaimCreationBond(actorId, market.id))}
          >
            Claim bond
          </button>
        </div>
        <dl className="compact-list">
          <div>
            <dt>Redeemable</dt>
            <dd>{lifecycle?.redeemable ?? "0 USDC"}</dd>
          </div>
          <div>
            <dt>Creator fees</dt>
            <dd>{lifecycle?.creatorFees ?? "0 USDC"}</dd>
          </div>
          <div>
            <dt>Protocol fees</dt>
            <dd>{lifecycle?.protocolFees ?? "0 USDC"}</dd>
          </div>
          <div>
            <dt>Creation bond</dt>
            <dd>{lifecycle?.creationBond ?? "0 USDC"}</dd>
          </div>
        </dl>
      </div>
      {status && <p className={isErrorStatus(status) ? "error-text" : "status-text"}>{status}</p>}
    </article>
  );
}

function CreateScreen({
  actorId,
  dataSource,
  onMarketCreated,
}: {
  actorId: string;
  dataSource: ReturnType<typeof createMarketDataSource>;
  onMarketCreated: (market: DeployedMarket) => void;
}) {
  const [form, setForm] = useState<CreateDraftInput>({
    question: "",
    closeTime: toDateTimeLocal(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    resolutionSource: "",
    invalidConditions: "",
    creationBond: "100",
    initialLiquidity: "1000",
  });
  const [draftPreview, setDraftPreview] = useState<MarketDraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  const updateField = (field: keyof CreateDraftInput, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setDraftPreview(null);
    setError(null);
    setTxStatus(null);
  };

  const createLocalMarket = async () => {
    if (!draftPreview) {
      return;
    }
    setTxStatus("Create market pending...");
    try {
      const result = await dataSource.executeCreateMarket(actorId, draftPreview);
      setTxStatus(`Create market confirmed: ${shortAddress(result.hash)}`);
      onMarketCreated(result.market);
    } catch (caught) {
      setTxStatus(caught instanceof Error ? caught.message : "Create market failed");
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setDraftPreview(await dataSource.buildDraftPreview(form));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Draft validation failed");
      setDraftPreview(null);
    }
  };

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Create</p>
          <h1>New market draft</h1>
        </div>
      </header>

      <section className="create-layout">
        <form className="form-panel" onSubmit={onSubmit}>
          <label>
            Question
            <input
              value={form.question}
              onChange={(event) => updateField("question", event.target.value)}
              placeholder="Will..."
            />
          </label>
          <label>
            Close time
            <input
              type="datetime-local"
              value={form.closeTime}
              onChange={(event) => updateField("closeTime", event.target.value)}
            />
          </label>
          <label>
            Resolution source
            <input
              value={form.resolutionSource}
              onChange={(event) => updateField("resolutionSource", event.target.value)}
              placeholder="Source of truth"
            />
          </label>
          <label>
            Invalid conditions
            <textarea
              value={form.invalidConditions}
              onChange={(event) => updateField("invalidConditions", event.target.value)}
              rows={4}
            />
          </label>
          <div className="two-column">
            <label>
              Creation bond
              <input
                inputMode="decimal"
                value={form.creationBond}
                onChange={(event) => updateField("creationBond", event.target.value)}
              />
            </label>
            <label>
              Initial liquidity
              <input
                inputMode="decimal"
                value={form.initialLiquidity}
                onChange={(event) => updateField("initialLiquidity", event.target.value)}
              />
            </label>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit">Build draft</button>
        </form>

        <DraftPreview preview={draftPreview} onCreate={createLocalMarket} txStatus={txStatus} />
      </section>
    </>
  );
}

function DraftPreview({
  preview,
  onCreate,
  txStatus,
}: {
  preview: MarketDraftResponse | null;
  onCreate: () => void;
  txStatus: string | null;
}) {
  if (!preview) {
    return (
      <aside className="preview-panel empty">
        <h2>Draft preview</h2>
        <p>No draft built.</p>
      </aside>
    );
  }

  return (
    <aside className="preview-panel">
      <h2>Draft preview</h2>
      <dl className="compact-list">
        <div>
          <dt>Question</dt>
          <dd>{preview.draft.question}</dd>
        </div>
        <div>
          <dt>Spec hash</dt>
          <dd>{shortAddress(preview.factoryArgs.specHash)}</dd>
        </div>
        <div>
          <dt>Metadata URI</dt>
          <dd>{preview.factoryArgs.metadataURI}</dd>
        </div>
        <div>
          <dt>Close time</dt>
          <dd>{preview.factoryArgs.closeTime}</dd>
        </div>
        <div>
          <dt>Creation bond units</dt>
          <dd>{preview.factoryArgs.creationBond}</dd>
        </div>
        <div>
          <dt>Initial liquidity units</dt>
          <dd>{preview.factoryArgs.initialLiquidity}</dd>
        </div>
      </dl>
      <button onClick={onCreate}>Create local market</button>
      {txStatus && <p className={txStatus.includes("failed") || txStatus.includes("not loaded") ? "error-text" : "status-text"}>{txStatus}</p>}
    </aside>
  );
}

function PortfolioScreen({
  actorId,
  dataSource,
  refreshKey,
  onOpenMarket,
}: {
  actorId: string;
  dataSource: ReturnType<typeof createMarketDataSource>;
  refreshKey: number;
  onOpenMarket: (marketId: string) => void;
}) {
  const staticPortfolio = dataSource.getPortfolio(actorId);
  const [livePortfolio, setLivePortfolio] = useState<PortfolioReadModel | null>(null);
  const [lpReadbackStatus, setLpReadbackStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLivePortfolio(null);
    setLpReadbackStatus("Refreshing LP positions...");
    dataSource
      .readLpPortfolio(actorId)
      .then((portfolio) => {
        if (cancelled) {
          return;
        }
        setLivePortfolio(portfolio);
        setLpReadbackStatus(null);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setLpReadbackStatus(caught instanceof Error ? caught.message : "LP portfolio readback unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [actorId, dataSource, refreshKey]);

  const shouldUseLivePortfolio = Boolean(
    livePortfolio &&
    (livePortfolio.positions.length > 0 ||
      staticPortfolio.actor.role === "LiquidityProvider" ||
      staticPortfolio.positions.some((position) => position.lpShares !== "0")),
  );
  const portfolio = shouldUseLivePortfolio && livePortfolio ? livePortfolio : staticPortfolio;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1>{portfolio.actor.name}</h1>
        </div>
        <span className="count-pill">{shortAddress(portfolio.actor.address)}</span>
      </header>

      <section className="metric-grid portfolio-summary">
        <Metric label="YES markets" value={String(portfolio.totals.yesMarkets)} />
        <Metric label="NO markets" value={String(portfolio.totals.noMarkets)} />
        <Metric label="LP markets" value={String(portfolio.totals.lpMarkets)} />
        <Metric label="Claimable" value={portfolio.totals.claimable} />
      </section>
      {lpReadbackStatus && !livePortfolio && (
        <p className={lpReadbackStatus.startsWith("Refreshing") ? "status-text" : "error-text"}>{lpReadbackStatus}</p>
      )}

      <section className="market-table" aria-label="Portfolio positions">
        <div className="market-row portfolio-row table-head">
          <span>Market</span>
          <span>Status</span>
          <span>YES</span>
          <span>NO</span>
          <span>LP</span>
          <span>Redeemable</span>
          <span>Claimable</span>
          <span />
        </div>
        {portfolio.positions.length === 0 && (
          <div className="empty-state inline">
            <h2>No positions</h2>
          </div>
        )}
        {portfolio.positions.map((position) => (
          <article className="market-row portfolio-row" key={position.marketId}>
            <div>
              <h2>{position.marketQuestion}</h2>
              <p>{position.resolution}</p>
            </div>
            <span className="status">{position.status}</span>
            <span>{position.yesShares}</span>
            <span>{position.noShares}</span>
            <span>{position.lpShares}</span>
            <span>{position.redeemable}</span>
            <span>{position.claimable}</span>
            <button className="secondary" onClick={() => onOpenMarket(position.marketId)}>
              Open
            </button>
          </article>
        ))}
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
