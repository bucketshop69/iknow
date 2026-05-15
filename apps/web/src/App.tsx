import { useEffect, useMemo, useState } from "react";
import type { LocalDeployment, MarketDraftResponse } from "@iknow/shared";
import {
  apiBaseUrl,
  contractSurface,
  createMarketDataSource,
  devActorsFromDeployment,
  loadLocalDeployment,
} from "./data";
import type {
  CreateDraftInput,
  DevActor,
  MarketReadModel,
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
        <RuntimePanel surface={surface} state={deploymentState} />
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
            onBack={() => navigate({ screen: "markets" })}
          />
        )}
        {route.screen === "create" && <CreateScreen actorId={actorId} dataSource={dataSource} />}
        {route.screen === "portfolio" && (
          <PortfolioScreen
            actorId={actorId}
            dataSource={dataSource}
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

function RuntimePanel({ surface, state }: { surface: ReturnType<typeof contractSurface>; state: string }) {
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
  onBack,
}: {
  market?: MarketReadModel;
  actorId: string;
  dataSource: ReturnType<typeof createMarketDataSource>;
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

        <MarketActionPanel actorId={actorId} market={market} dataSource={dataSource} />
      </section>
    </>
  );
}

function MarketActionPanel({
  actorId,
  market,
  dataSource,
}: {
  actorId: string;
  market: MarketReadModel;
  dataSource: ReturnType<typeof createMarketDataSource>;
}) {
  const [tradeAmount, setTradeAmount] = useState("25");
  const [liquidityAmount, setLiquidityAmount] = useState("100");
  const [status, setStatus] = useState<string | null>(null);

  const runAction = async (label: string, action: () => Promise<string>) => {
    setStatus(`${label} pending...`);
    try {
      const hash = await action();
      setStatus(`${label} confirmed: ${shortAddress(hash)}`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : `${label} failed`);
    }
  };

  return (
    <article className="wide-card">
      <h2>Local actions</h2>
      <div className="action-grid">
        <label>
          Trade amount
          <input inputMode="decimal" value={tradeAmount} onChange={(event) => setTradeAmount(event.target.value)} />
        </label>
        <div className="button-row">
          <button onClick={() => runAction("Buy YES", () => dataSource.executeBuy(actorId, market.id, "YES", tradeAmount))}>
            Buy YES
          </button>
          <button onClick={() => runAction("Buy NO", () => dataSource.executeBuy(actorId, market.id, "NO", tradeAmount))}>
            Buy NO
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
          onClick={() => runAction("Add liquidity", () => dataSource.executeAddLiquidity(actorId, market.id, liquidityAmount))}
        >
          Add liquidity
        </button>
      </div>
      {status && <p className={status.includes("failed") || status.includes("must") ? "error-text" : "status-text"}>{status}</p>}
    </article>
  );
}

function CreateScreen({ actorId, dataSource }: { actorId: string; dataSource: ReturnType<typeof createMarketDataSource> }) {
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
      const hash = await dataSource.executeCreateMarket(actorId, draftPreview);
      setTxStatus(`Create market confirmed: ${shortAddress(hash)}`);
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
  onOpenMarket,
}: {
  actorId: string;
  dataSource: ReturnType<typeof createMarketDataSource>;
  onOpenMarket: (marketId: string) => void;
}) {
  const portfolio = dataSource.getPortfolio(actorId);

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

      <section className="market-table" aria-label="Portfolio positions">
        <div className="market-row portfolio-row table-head">
          <span>Market</span>
          <span>YES</span>
          <span>NO</span>
          <span>LP</span>
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
            <h2>{position.marketQuestion}</h2>
            <span>{position.yesShares}</span>
            <span>{position.noShares}</span>
            <span>{position.lpShares}</span>
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
