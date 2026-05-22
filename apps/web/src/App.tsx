import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  CREATE_MIN_CREATION_BOND_USDC,
  CREATE_MIN_INITIAL_LIQUIDITY_USDC,
  type DeployedMarket,
  type MarketDraftResponse,
} from "@iknow/shared";
import { useAccount, useConnect, useDisconnect, useWalletClient } from "wagmi";
import { createWalletClient, custom, type WalletClient } from "viem";
import {
  chainRuntimeMode,
  apiBaseUrl,
  contractSurface,
  createMarketDataSource,
  devActorsFromDeployment,
  loadAppDeployment,
  type AppDeployment,
  type ResolutionOutcomeInput,
  type TradeAction,
  type TradeQuoteReadback,
} from "./data";
import { curatedMarketTags, fetchImportCandidates, marketIdeaSuggestions } from "./importMarkets";
import { iknowTheme } from "./tokens";
import { arcTestnetChain } from "./wagmi";
import type {
  CreateDraftInput,
  DevActor,
  EvidenceBriefReadModel,
  MarketLifecycleReadback,
  MarketUserState,
  MarketImportCandidate,
  MarketReadModel,
  PortfolioReadModel,
  Route,
} from "./types";

const initialRoute = (): Route => {
  const path = window.location.pathname;

  if (path === "/create") {
    return { screen: "create" };
  }

  if (path === "/profile" || path === "/portfolio") {
    return { screen: "profile" };
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

  if (route.screen === "profile") {
    return "/profile";
  }

  if (route.screen === "market") {
    return `/markets/${encodeURIComponent(route.marketId)}`;
  }

  return "/";
};

const shortAddress = (address?: string) =>
  address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not deployed";

type BrowserEthereumProvider = Parameters<typeof custom>[0];

declare global {
  interface Window {
    ethereum?: BrowserEthereumProvider;
  }
}

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatUsdcUnits = (value: string) => {
  try {
    const amount = BigInt(value);
    const whole = amount / 1_000_000n;
    const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/g, "");

    return `${Number(whole).toLocaleString()}${fraction ? `.${fraction}` : ""} USDC`;
  } catch {
    return `${value} units`;
  }
};

const formatConfidence = (value: number | null) => {
  if (value === null) {
    return "Unknown";
  }

  return `${Math.round(value * 100)}%`;
};

const isUrl = (value: string) => /^https?:\/\//i.test(value);

const toDateTimeLocal = (date: Date) => {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const CREATE_CLOSE_BUFFER_MS = 14 * 24 * 60 * 60 * 1000;

const createClockMs = (deployment?: AppDeployment | null, chainClockMs?: number | null) =>
  Math.max(Date.now(), (deployment?.generatedAtBlockTimestamp ?? 0) * 1000, chainClockMs ?? 0);

const createDefaultCloseTime = (deployment?: AppDeployment | null, chainClockMs?: number | null) =>
  toDateTimeLocal(new Date(createClockMs(deployment, chainClockMs) + CREATE_CLOSE_BUFFER_MS));

const normalizeCreateCloseTime = (value: string, deployment?: AppDeployment | null, chainClockMs?: number | null) => {
  const parsedMs = Date.parse(value);
  const minimumMs = createClockMs(deployment, chainClockMs) + CREATE_CLOSE_BUFFER_MS;

  return toDateTimeLocal(new Date(Number.isFinite(parsedMs) && parsedMs > minimumMs ? parsedMs : minimumMs));
};

const createEmptyDraftInput = (deployment?: AppDeployment | null, chainClockMs?: number | null): CreateDraftInput => ({
  question: "",
  closeTime: createDefaultCloseTime(deployment, chainClockMs),
  resolutionSource: "",
  invalidConditions: "",
  creationBond: CREATE_MIN_CREATION_BOND_USDC,
  initialLiquidity: CREATE_MIN_INITIAL_LIQUIDITY_USDC,
});

const sourceIdeaFromCandidate = (candidate: MarketImportCandidate) => ({
  provider: candidate.sourceProvider ?? "polymarket",
  externalId: candidate.externalId,
  url: candidate.sourceUrl,
  imageUrl: candidate.imageUrl,
  question: candidate.question,
  closeTime: candidate.closeTime,
});

const sourceIdeaKey = (provider: string | undefined, externalId: string | undefined) => {
  const normalizedProvider = (provider ?? "polymarket").trim().toLowerCase();
  const normalizedExternalId = externalId?.trim();

  return normalizedProvider && normalizedExternalId ? `${normalizedProvider}:${normalizedExternalId}` : null;
};

const sourceIdeaKeyFromCandidate = (candidate: MarketImportCandidate) =>
  sourceIdeaKey(candidate.sourceProvider, candidate.externalId);

const sourceIdeaKeyFromMarket = (market: MarketReadModel) =>
  sourceIdeaKey(market.sourceIdea?.provider, market.sourceIdea?.externalId);

const CREATE_IDEA_PAGE_SIZE = 3;

async function readDeploymentBlockClockMs(deployment: AppDeployment) {
  const response = await fetch(deployment.chain.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    }),
  });
  const payload = (await response.json()) as { result?: { timestamp?: string } };
  const timestamp = payload.result?.timestamp;
  if (!timestamp) {
    return null;
  }

  return Number(BigInt(timestamp)) * 1000;
}

function App() {
  const [route, setRoute] = useState<Route>(initialRoute);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.localStorage.getItem("iknow-theme") === "dark" ? "dark" : "light",
  );
  const account = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: chainRuntimeMode === "arc-testnet" ? arcTestnetChain.id : undefined });
  const [connectorWalletClient, setConnectorWalletClient] = useState<WalletClient | undefined>(undefined);
  const [deployment, setDeployment] = useState<AppDeployment | null>(null);
  const [deploymentState, setDeploymentState] = useState<"loading" | "ready" | "fallback">("loading");
  const connectedWalletAddress = account.address as `0x${string}` | undefined;
  const activeWalletClient = walletClient ?? connectorWalletClient;
  const actors = useMemo(() => devActorsFromDeployment(deployment, connectedWalletAddress), [deployment, connectedWalletAddress]);
  const [actorId, setActorId] = useState(chainRuntimeMode === "arc-testnet" ? "wallet" : "traderYes");
  const surface = useMemo(() => contractSurface(deployment), [deployment]);
  const dataSource = useMemo(
    () =>
      createMarketDataSource(deployment, actors, {
        address: connectedWalletAddress,
        chainId: account.chainId,
        walletClient: activeWalletClient,
      }),
    [account.chainId, activeWalletClient, actors, connectedWalletAddress, deployment],
  );
  const fallbackMarkets = dataSource.listMarkets();
  const [liveMarkets, setLiveMarkets] = useState<MarketReadModel[] | null>(null);
  const [marketReadbackStatus, setMarketReadbackStatus] = useState<string | null>(null);
  const markets = liveMarkets ?? fallbackMarkets;
  const actor = actors.find((candidate) => candidate.id === actorId) ?? actors[0];
  const [chainRefreshKey, setChainRefreshKey] = useState(0);
  const themeColors = iknowTheme[theme].color;
  const appFrameStyle = {
    "--shell-bg": themeColors.background,
    "--shell-ink": themeColors.text,
    "--shell-muted": themeColors.muted,
    "--shell-soft": themeColors.soft,
    "--shell-line": themeColors.border,
    "--shell-card": themeColors.surface,
    "--shell-card-soft": themeColors.surfaceRaised,
    "--shell-nav-bg": themeColors.navBackground,
    "--shell-nav-active-text": themeColors.navActiveText,
    "--shell-primary": themeColors.primary,
    "--shell-primary-ink": themeColors.primaryText,
    "--shell-yes": themeColors.yes,
    "--shell-yes-bg": themeColors.yesSurface,
    "--shell-yes-line": themeColors.yesBorder,
    "--shell-no": themeColors.no,
    "--shell-no-bg": themeColors.noSurface,
    "--shell-no-line": themeColors.noBorder,
    "--shell-receipt": themeColors.receipt,
    "--shell-receipt-bg": themeColors.receiptSurface,
    "--shell-mascot-bg": themeColors.mascotSurface,
    "--shell-mascot-shadow": themeColors.mascotShadow,
    "--shell-input": themeColors.inputSurface,
    "--shell-inverted-text": themeColors.invertedText,
    "--shell-inverted-muted": themeColors.invertedMuted,
    "--shell-shadow-color": themeColors.shadow,
    "--shell-control-radius": iknowTheme.radius.control,
    "--shell-card-radius": iknowTheme.radius.card,
    "--shell-panel-radius": iknowTheme.radius.panel,
  } as CSSProperties;

  const refreshDeployment = async () => {
    setDeploymentState("loading");
    try {
      const nextDeployment = await loadAppDeployment();
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
    window.localStorage.setItem("iknow-theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    loadAppDeployment()
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

  useEffect(() => {
    if (deployment?.mode === "arc-testnet" && actorId !== "wallet") {
      setActorId("wallet");
    }
  }, [actorId, deployment?.mode]);

  useEffect(() => {
    if (chainRuntimeMode !== "arc-testnet" || !connectedWalletAddress || !window.ethereum) {
      setConnectorWalletClient(undefined);
      return;
    }

    setConnectorWalletClient(
      createWalletClient({
        account: connectedWalletAddress,
        chain: arcTestnetChain,
        transport: custom(window.ethereum),
      }),
    );
  }, [connectedWalletAddress]);

  useEffect(() => {
    let cancelled = false;

    setMarketReadbackStatus("Refreshing live markets...");
    dataSource
      .readMarkets()
      .then((nextMarkets) => {
        if (cancelled) {
          return;
        }
        setLiveMarkets(nextMarkets);
        setMarketReadbackStatus(null);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setLiveMarkets(null);
        setMarketReadbackStatus(caught instanceof Error ? caught.message : "Live market readback unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource, chainRefreshKey]);

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
    <div className="app-frame" data-theme={theme} style={appFrameStyle}>
      <ShellHeader
        route={route}
        surface={surface}
        theme={theme}
        onNavigate={navigate}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />

      <main className="workspace">
        <LocalDemoControls
          actor={actor}
          actorId={actorId}
          actors={actors}
          deploymentState={deploymentState}
          surface={surface}
          onActorChange={setActorId}
          onRefresh={refreshChainReadbacks}
        />
        {route.screen === "markets" && (
          <MarketsScreen
            markets={markets}
            readbackStatus={marketReadbackStatus}
            onOpenMarket={(marketId) => navigate({ screen: "market", marketId })}
          />
        )}
        {route.screen === "market" && (
          <MarketDetailScreen
            market={markets.find((market) => market.id === route.marketId) ?? dataSource.getMarket(route.marketId)}
            actorId={actorId}
            dataSource={dataSource}
            refreshKey={chainRefreshKey}
            onTransactionConfirmed={refreshChainReadbacks}
            onBack={() => navigate({ screen: "markets" })}
          />
        )}
        {route.screen === "create" && (
          <CreateScreen
            actorId={actorId}
            dataSource={dataSource}
            deployment={deployment}
            markets={markets}
            onOpenMarket={(marketId) => navigate({ screen: "market", marketId })}
            onMarketCreated={addCreatedMarket}
          />
        )}
        {route.screen === "profile" && (
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

function ShellHeader({
  route,
  surface,
  theme,
  onNavigate,
  onToggleTheme,
}: {
  route: Route;
  surface: ReturnType<typeof contractSurface>;
  theme: "light" | "dark";
  onNavigate: (route: Route) => void;
  onToggleTheme: () => void;
}) {
  const isHome = route.screen === "markets" || route.screen === "market";

  return (
    <header className="shell-topbar">
      <button className="shell-brand" type="button" onClick={() => onNavigate({ screen: "markets" })}>
        <MugMascot />
        <span>
          <strong>iknow</strong>
          <span>calls with receipts</span>
        </span>
      </button>

      <nav className="shell-nav" aria-label="Main navigation">
        <button className={isHome ? "active" : ""} type="button" onClick={() => onNavigate({ screen: "markets" })}>
          Home
        </button>
        <button
          className={route.screen === "create" ? "active" : ""}
          type="button"
          onClick={() => onNavigate({ screen: "create" })}
        >
          Create
        </button>
        <button
          className={route.screen === "profile" ? "active" : ""}
          type="button"
          onClick={() => onNavigate({ screen: "profile" })}
        >
          Profile
        </button>
      </nav>

      <div className="shell-actions">
        <button className="shell-pill" type="button" onClick={onToggleTheme}>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <span className="shell-pill">{surface.chainName || "Arc Testnet"}</span>
        <HeaderWalletAction />
      </div>
    </header>
  );
}

function HeaderWalletAction() {
  const [isOpen, setIsOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [connectError, setConnectError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const account = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const availableConnectors = connectors;
  const activeAddress = account.address;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    setCopyStatus("idle");
  }, [activeAddress]);

  useEffect(() => {
    setConnectError(error?.message ?? null);
  }, [error]);

  const copyAddress = async () => {
    if (!activeAddress) {
      return;
    }

    try {
      await navigator.clipboard.writeText(activeAddress);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1600);
    } catch {
      setCopyStatus("failed");
    }
  };

  if (activeAddress) {
    return (
      <div className="wallet-menu" ref={menuRef}>
        <button
          className="shell-pill wallet-trigger"
          type="button"
          aria-expanded={isOpen}
          aria-haspopup="menu"
          onClick={() => setIsOpen((current) => !current)}
        >
          {shortAddress(activeAddress)}
        </button>
        {isOpen && (
          <div className="wallet-popover" role="menu">
            <span className="wallet-label">Connected wallet</span>
            <code>{activeAddress}</code>
            <button className="wallet-menu-action" type="button" role="menuitem" onClick={copyAddress}>
              {copyStatus === "copied" ? "Copied address" : copyStatus === "failed" ? "Copy failed" : "Copy address"}
            </button>
            <button
              className="wallet-menu-action danger"
              type="button"
              role="menuitem"
              onClick={() => {
                disconnect();
                setIsOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-menu" ref={menuRef}>
      <button
        className="shell-pill wallet-trigger"
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        disabled={isPending}
        onClick={() => setIsOpen((current) => !current)}
      >
        {isPending ? "Connecting" : "Connect"}
      </button>
      {isOpen && (
        <div className="wallet-modal-backdrop" onMouseDown={() => setIsOpen(false)}>
          <section
            className="wallet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="wallet-modal-head">
              <div>
                <span className="wallet-label">iknow wallet</span>
                <h2 id="wallet-modal-title">Connect wallet</h2>
              </div>
              <button className="wallet-close" type="button" aria-label="Close wallet modal" onClick={() => setIsOpen(false)}>
                x
              </button>
            </div>

            <button
              className="wallet-passkey-option"
              type="button"
              disabled
            >
              <strong>Continue with passkey</strong>
              <span>Circle Modular Wallet on Arc Testnet - coming soon</span>
            </button>

            <div className="wallet-modal-divider">
              <span>or</span>
            </div>

            <div className="wallet-option-list">
              {availableConnectors.length > 0 ? (
                availableConnectors.map((connector) => (
                  <button
                    className="wallet-menu-action"
                    type="button"
                    key={connector.uid}
                    disabled={isPending}
                    onClick={() => {
                      setConnectError(null);
                      connect({ connector });
                      setIsOpen(false);
                    }}
                  >
                    {connector.name || "Browser wallet"}
                  </button>
                ))
              ) : (
                <p>Install a wallet extension or use Chrome with your wallet profile.</p>
              )}
            </div>

            {connectError && <p className="wallet-error">{connectError}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function LocalDemoControls({
  actor,
  actorId,
  actors,
  deploymentState,
  surface,
  onActorChange,
  onRefresh,
}: {
  actor: DevActor;
  actorId: string;
  actors: DevActor[];
  deploymentState: string;
  surface: ReturnType<typeof contractSurface>;
  onActorChange: (actorId: string) => void;
  onRefresh: () => void;
}) {
  const isArcTestnet = surface.chainId !== 31337;

  return (
    <details className="local-demo-controls">
      <summary>{isArcTestnet ? "Testnet controls" : "Local demo controls"}</summary>
      <div className="local-demo-grid">
        <label>
          {isArcTestnet ? "Signer" : "Actor"}
          <select value={actorId} disabled={isArcTestnet} onChange={(event) => onActorChange(event.target.value)}>
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
        </dl>
        <dl className="compact-list">
          <div>
            <dt>Deployment</dt>
            <dd>{deploymentState === "ready" ? "Loaded" : deploymentState === "loading" ? "Loading" : `Fallback (${apiBaseUrl})`}</dd>
          </div>
          <div>
            <dt>Factory</dt>
            <dd>{shortAddress(surface.marketFactory)}</dd>
          </div>
        </dl>
        <button className="secondary" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </details>
  );
}

function MarketsScreen({
  markets,
  readbackStatus,
  onOpenMarket,
}: {
  markets: MarketReadModel[];
  readbackStatus: string | null;
  onOpenMarket: (marketId: string) => void;
}) {
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Home</p>
          <h1>What do you know today?</h1>
        </div>
        <span className="count-pill">{markets.length} markets</span>
      </header>
      {readbackStatus && (
        <p className={readbackStatus.startsWith("Refreshing") ? "status-text" : "error-text"}>{readbackStatus}</p>
      )}

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
            <div className="market-row-main">
              {(market.imageUrl || market.sourceIdea?.imageUrl) && (
                <img className="market-thumb" src={market.imageUrl ?? market.sourceIdea?.imageUrl} alt="" />
              )}
              <div>
                <h2>{market.question}</h2>
                <p>Closes {formatDate(market.closeTime)}</p>
              </div>
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
        <div className="market-detail-title">
          {(market.imageUrl || market.sourceIdea?.imageUrl) && (
            <img className="market-detail-image" src={market.imageUrl ?? market.sourceIdea?.imageUrl} alt="" />
          )}
          <div>
            <p className="eyebrow">Market detail</p>
            <h1>{market.question}</h1>
          </div>
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

        <EvidenceBriefPanel
          actorId={actorId}
          market={market}
          dataSource={dataSource}
          refreshKey={refreshKey}
          onTransactionConfirmed={onTransactionConfirmed}
        />

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

function EvidenceBriefPanel({
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
  const [lifecycle, setLifecycle] = useState<MarketLifecycleReadback | null>(null);
  const [brief, setBrief] = useState<EvidenceBriefReadModel | null>(null);
  const [lookupValue, setLookupValue] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    dataSource
      .readMarketLifecycle(actorId, market.id)
      .then((nextLifecycle) => {
        if (!cancelled) {
          setLifecycle(nextLifecycle);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLifecycle(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actorId, dataSource, market.id, refreshKey]);

  useEffect(() => {
    setBrief(null);
    setLookupValue("");
    setStatus(null);
  }, [market.id]);

  const showBrief = (nextBrief: EvidenceBriefReadModel) => {
    setBrief(nextBrief);
    setLookupValue(nextBrief.evidenceURI);
  };

  const prepareBrief = async () => {
    setStatus("Preparing evidence packet...");
    try {
      const nextBrief = await dataSource.prepareEvidencePacket({ actorId, market });
      showBrief(nextBrief);
      setStatus("Evidence packet ready.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Prepare evidence packet failed");
    }
  };

  const fetchBrief = async () => {
    if (!lookupValue.trim()) {
      return;
    }

    setStatus("Fetching evidence packet...");
    try {
      const nextBrief = await dataSource.readEvidencePacket(lookupValue);
      showBrief(nextBrief);
      setStatus("Evidence packet loaded.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Fetch evidence packet failed");
    }
  };

  const proposeWithEvidence = async () => {
    if (!brief || brief.suggestedOutcome === "UNKNOWN") {
      return;
    }

    setStatus("Propose with evidence pending...");
    try {
      const hash = await dataSource.executeProposeResolution(
        actorId,
        market.id,
        brief.suggestedOutcome,
        brief.evidenceURI,
      );
      setStatus(`Propose with evidence confirmed: ${shortAddress(hash)}`);
      onTransactionConfirmed();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Propose with evidence failed");
    }
  };

  const isResolverActor = actorId === "resolver";
  const canPrepare = lifecycle?.state === "Closed" || Boolean(lifecycle?.canPropose);
  const canPropose = Boolean(isResolverActor && lifecycle?.canPropose && brief && brief.suggestedOutcome !== "UNKNOWN");
  const isErrorStatus = Boolean(
    status &&
      ["failed", "must", "not loaded", "unknown", "greater", "insufficient", "revert", "unavailable"].some((token) =>
        status.toLowerCase().includes(token),
      ),
  );

  return (
    <article className="wide-card evidence-card">
      <div className="section-header">
        <div>
          <h2>Evidence brief</h2>
          <p>Prepare or fetch the resolution packet for a closed market.</p>
        </div>
        <span className="status">{lifecycle?.state ?? "Lifecycle unavailable"}</span>
      </div>

      <div className="evidence-controls">
        <button className="secondary" disabled={!canPrepare} onClick={prepareBrief}>
          Prepare packet
        </button>
        <label>
          Evidence id or URI
          <input value={lookupValue} onChange={(event) => setLookupValue(event.target.value)} />
        </label>
        <button className="secondary" disabled={!lookupValue.trim()} onClick={fetchBrief}>
          Fetch packet
        </button>
        <button disabled={!canPropose} onClick={proposeWithEvidence}>
          Propose with evidence
        </button>
      </div>

      {!isResolverActor && (
        <p className="status-text">Switch to the Resolver actor to submit the packet-backed proposal.</p>
      )}
      {status && <p className={isErrorStatus ? "error-text" : "status-text"}>{status}</p>}

      {brief ? <EvidenceBriefView brief={brief} /> : <p className="empty-copy">No evidence packet loaded.</p>}
    </article>
  );
}

function EvidenceBriefView({ brief }: { brief: EvidenceBriefReadModel }) {
  return (
    <div className="evidence-brief">
      <dl className="compact-list evidence-summary">
        <div>
          <dt>Suggested outcome</dt>
          <dd>{brief.suggestedOutcome}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{formatConfidence(brief.confidence)}</dd>
        </div>
        <div>
          <dt>Policy status</dt>
          <dd>{brief.policyStatus}</dd>
        </div>
        <div>
          <dt>Generated at</dt>
          <dd>{formatDate(brief.generatedAt)}</dd>
        </div>
        <div>
          <dt>Agent id</dt>
          <dd>{brief.agentId}</dd>
        </div>
        <div>
          <dt>Evidence URI</dt>
          <dd>{brief.evidenceURI}</dd>
        </div>
      </dl>

      <div className="evidence-columns">
        <EvidenceList title="Agent reasoning" emptyLabel="No reasoning returned.">
          {brief.facts.map((fact) => (
            <li key={`${fact.label}-${fact.value}`}>
              <strong>{fact.label}</strong>
              <span>{fact.value}</span>
            </li>
          ))}
        </EvidenceList>

        <EvidenceList title="Evidence links" emptyLabel="No evidence links returned.">
          {brief.evidenceLinks.map((link) => (
            <li key={`${link.label}-${link.url}`}>
              <strong>{link.label}</strong>
              {isUrl(link.url) ? (
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.source ?? link.url}
                </a>
              ) : (
                <span>{link.source ? `${link.source}: ${link.url}` : link.url}</span>
              )}
            </li>
          ))}
        </EvidenceList>

        <EvidenceList title="Invalid checks" emptyLabel="No invalid checks returned.">
          {brief.invalidChecks.map((check) => (
            <li key={`${check.label}-${check.status}`}>
              <strong>{check.label}</strong>
              <span>
                <span className={`check-status ${check.status}`}>{check.status}</span>
                {check.note ? ` ${check.note}` : ""}
              </span>
            </li>
          ))}
        </EvidenceList>
      </div>
    </div>
  );
}

function EvidenceList({
  title,
  emptyLabel,
  children,
}: {
  title: string;
  emptyLabel: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;

  return (
    <section className="evidence-list">
      <h3>{title}</h3>
      {isEmpty ? <p className="empty-copy">{emptyLabel}</p> : <ul>{items}</ul>}
    </section>
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
            disabled={lifecycle?.state !== "Open"}
            onClick={() => runAction("Warp to close", () => dataSource.executeWarpToClose(market.id))}
          >
            Warp close
          </button>
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
            disabled={lifecycle?.state !== "Resolution proposed"}
            onClick={() => runAction("Warp challenge", () => dataSource.executeWarpChallengeWindow(market.id))}
          >
            Warp challenge
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
  deployment,
  markets,
  onOpenMarket,
  onMarketCreated,
}: {
  actorId: string;
  dataSource: ReturnType<typeof createMarketDataSource>;
  deployment: AppDeployment | null;
  markets: MarketReadModel[];
  onOpenMarket: (marketId: string) => void;
  onMarketCreated: (market: DeployedMarket) => void;
}) {
  const [chainClockMs, setChainClockMs] = useState<number | null>(null);
  const [form, setForm] = useState<CreateDraftInput>(() => createEmptyDraftInput(deployment));
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<MarketImportCandidate[]>([]);
  const [candidatePage, setCandidatePage] = useState(0);
  const [selectedCandidate, setSelectedCandidate] = useState<MarketImportCandidate | null>(null);
  const [browseStatus, setBrowseStatus] = useState<string | null>(null);
  const [draftPreview, setDraftPreview] = useState<MarketDraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const readyPanelRef = useRef<HTMLDivElement | null>(null);
  const selectedTagLabel = curatedMarketTags.find((tag) => tag.slug === selectedTag)?.label ?? "Market ideas";
  const existingMarketsByIdeaKey = useMemo(() => {
    const byKey = new Map<string, MarketReadModel>();
    markets.forEach((market) => {
      const key = sourceIdeaKeyFromMarket(market);
      if (key && !byKey.has(key)) {
        byKey.set(key, market);
      }
    });

    return byKey;
  }, [markets]);
  const selectedExistingMarket = selectedCandidate
    ? existingMarketsByIdeaKey.get(sourceIdeaKeyFromCandidate(selectedCandidate) ?? "")
    : undefined;
  const discoverPill = browseStatus?.startsWith("Looking")
    ? "Searching"
    : search.trim()
      ? `${candidates.length} results`
      : selectedTag
        ? selectedTagLabel
        : "Trending now";
  const visibleBrowseStatus = browseStatus === "No matching market ideas found."
    ? "Nothing ready here yet. Try another tag or search."
    : browseStatus;
  const visibleMarketSuggestions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const candidateSuggestions = candidates.slice(0, CREATE_IDEA_PAGE_SIZE).map((candidate) => ({
      key: `candidate-${candidate.id}`,
      label: shortMarketTitle(candidate.question),
      query: candidate.question,
      candidate,
    }));
    const seedSuggestions = marketIdeaSuggestions.map((suggestion) => ({
      key: `seed-${suggestion.query}`,
      label: suggestion.label,
      query: suggestion.query,
    }));
    const seen = new Set<string>();

    return [...candidateSuggestions, ...seedSuggestions]
      .filter((suggestion) => {
        if (!normalizedSearch) {
          return true;
        }

        return `${suggestion.label} ${suggestion.query}`.toLowerCase().includes(normalizedSearch);
      })
      .filter((suggestion) => {
        const key = suggestion.query.toLowerCase();
        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      })
      .slice(0, CREATE_IDEA_PAGE_SIZE);
  }, [candidates, search]);
  const candidatePageCount = Math.max(1, Math.ceil(candidates.length / CREATE_IDEA_PAGE_SIZE));
  const visibleCandidatePage = Math.min(candidatePage, candidatePageCount - 1);
  const pagedCandidates = candidates.slice(
    visibleCandidatePage * CREATE_IDEA_PAGE_SIZE,
    visibleCandidatePage * CREATE_IDEA_PAGE_SIZE + CREATE_IDEA_PAGE_SIZE,
  );

  const updateField = (field: keyof CreateDraftInput, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setDraftPreview(null);
    setError(null);
    setTxStatus(null);
  };

  useEffect(() => {
    let cancelled = false;

    setCandidatePage(0);
    setBrowseStatus("Looking for market ideas...");
    fetchImportCandidates(selectedTag, search)
      .then((nextCandidates) => {
        if (cancelled) {
          return;
        }
        setCandidates(nextCandidates);
        setBrowseStatus(nextCandidates.length ? null : "No matching market ideas found.");
      })
      .catch((caught) => {
        if (!cancelled) {
          setCandidates([]);
          setBrowseStatus(caught instanceof Error ? caught.message : "Market ideas unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [search, selectedTag]);

  useEffect(() => {
    if (!deployment) {
      setChainClockMs(null);
      return;
    }

    let cancelled = false;
    readDeploymentBlockClockMs(deployment)
      .then((nextClockMs) => {
        if (!cancelled) {
          setChainClockMs(nextClockMs);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChainClockMs(deployment.generatedAtBlockTimestamp * 1000);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deployment]);

  useEffect(() => {
    if (!draftPreview) {
      return;
    }

    window.requestAnimationFrame(() => {
      readyPanelRef.current?.scrollIntoView({ block: "center" });
    });
  }, [draftPreview]);

  useEffect(() => {
    if (!selectedCandidate && !form.question) {
      setForm(createEmptyDraftInput(deployment, chainClockMs));
    }
  }, [chainClockMs, deployment, form.question, selectedCandidate]);

  useEffect(() => {
    if (!selectedCandidate) {
      return;
    }

    const normalizedCloseTime = normalizeCreateCloseTime(selectedCandidate.closeTime, deployment, chainClockMs);
    setForm((current) =>
      current.closeTime === normalizedCloseTime ? current : { ...current, closeTime: normalizedCloseTime },
    );
    setDraftPreview(null);
    setTxStatus(null);
  }, [chainClockMs, deployment, selectedCandidate]);

  const selectCandidate = (candidate: MarketImportCandidate) => {
    setSelectedCandidate(candidate);
    setForm((current) => ({
      ...current,
      question: candidate.question,
      closeTime: normalizeCreateCloseTime(candidate.closeTime, deployment, chainClockMs),
      resolutionSource: candidate.resolutionSource,
      invalidConditions: candidate.invalidConditions.join("\n"),
      imageUrl: candidate.imageUrl,
      sourceIdea: sourceIdeaFromCandidate(candidate),
    }));
    setDraftPreview(null);
    setError(null);
    setTxStatus(null);
  };

  const clearSelectedMarket = () => {
    setSelectedCandidate(null);
    setForm(createEmptyDraftInput(deployment, chainClockMs));
    setDraftPreview(null);
    setError(null);
    setTxStatus(null);
  };

  const applyMarketSuggestion = (suggestion: (typeof visibleMarketSuggestions)[number]) => {
    setSearch(suggestion.query);
    setSelectedTag(null);
    if ("candidate" in suggestion && suggestion.candidate) {
      selectCandidate(suggestion.candidate);
      return;
    }

    clearSelectedMarket();
  };

  const selectBestVisibleIdea = (query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchingCandidate = normalizedQuery
      ? candidates.find((candidate) =>
          `${candidate.question} ${candidate.description} ${candidate.tagLabel}`.toLowerCase().includes(normalizedQuery),
        )
      : candidates[0];

    if (matchingCandidate) {
      selectCandidate(matchingCandidate);
      return;
    }

    const matchingSuggestion = normalizedQuery
      ? visibleMarketSuggestions.find((suggestion) =>
          `${suggestion.label} ${suggestion.query}`.toLowerCase().includes(normalizedQuery),
        )
      : visibleMarketSuggestions[0];

    if (matchingSuggestion) {
      applyMarketSuggestion(matchingSuggestion);
    }
  };

  const createLocalMarket = async () => {
    if (!draftPreview) {
      return;
    }
    if (selectedExistingMarket) {
      onOpenMarket(selectedExistingMarket.id);
      return;
    }
    setTxStatus("Creating your market...");
    try {
      const result = await dataSource.executeCreateMarket(actorId, draftPreview, {
        imageUrl: form.imageUrl,
        sourceIdea: form.sourceIdea,
      });
      setTxStatus(`Market created. Receipt ${shortAddress(result.hash)}`);
      onMarketCreated(result.market);
    } catch (caught) {
      setTxStatus(caught instanceof Error ? caught.message : "Could not create this market");
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCandidate) {
      setError("Select a market idea first.");
      return;
    }
    if (selectedExistingMarket) {
      onOpenMarket(selectedExistingMarket.id);
      return;
    }
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
      <section className="create-experience">
        <section className="create-main-grid">
          <section className="create-panel market-browser" aria-label="Browse market ideas">
            <div className="create-section-head create-idea-head">
              <div>
                <h1>I know what people should bet on</h1>
                <span>Search what you already know, or start with a suggestion while the idea is still forming.</span>
              </div>
              <span className="create-count">{discoverPill}</span>
            </div>

            <label className="create-search-field">
              Market idea
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    selectBestVisibleIdea(event.currentTarget.value);
                  }
                }}
                placeholder="Create a market on..."
              />
            </label>

            <div className="create-suggestion-block" aria-label="Market idea suggestions">
              <div className="create-suggestion-head">
                <strong>{search.trim() ? "Maybe this?" : "Think about"}</strong>
                <span>{search.trim() ? "Matching starts" : "A few starts if your brain is loading"}</span>
              </div>
              <div className="create-suggestion-list">
                {visibleMarketSuggestions.map((suggestion) => (
                  <button key={suggestion.key} type="button" onClick={() => applyMarketSuggestion(suggestion)}>
                    <span>{suggestion.label}</span>
                    <span>+</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="create-tag-list" aria-label="Browse by topic">
              {curatedMarketTags.map((tag) => (
                <button
                  key={tag.slug}
                  className={tag.slug === selectedTag ? "create-tag-chip active" : "create-tag-chip"}
                  type="button"
                  onClick={() => setSelectedTag((current) => (current === tag.slug ? null : tag.slug))}
                >
                  {tag.label}
                </button>
              ))}
              {selectedTag && (
                <button className="create-tag-chip clear" type="button" onClick={() => setSelectedTag(null)}>
                  Clear filters
                </button>
              )}
            </div>

            {visibleBrowseStatus && (
              <p className={visibleBrowseStatus.startsWith("Looking") ? "create-note" : "create-empty-note"}>
                {visibleBrowseStatus}
              </p>
            )}

            <div className="market-result-list">
              {pagedCandidates.map((candidate) => {
                const existingMarket = existingMarketsByIdeaKey.get(sourceIdeaKeyFromCandidate(candidate) ?? "");
                const isSelected = selectedCandidate?.id === candidate.id;

                return (
                  <button
                    key={candidate.id}
                    className={isSelected ? "market-result selected" : "market-result"}
                    type="button"
                    onClick={() => (existingMarket ? onOpenMarket(existingMarket.id) : selectCandidate(candidate))}
                  >
                    <div>
                      <h3>{candidate.question}</h3>
                    </div>
                    <div className="market-meta-row">
                      <span>{existingMarket ? "Already on iknow" : isSelected ? "Selected market" : "Rules ready"}</span>
                      <span>{candidate.tagLabel || selectedTagLabel}</span>
                      <span>{formatDate(candidate.closeTime)}</span>
                    </div>
                    <span className={isSelected ? "create-result-action active" : "create-result-action"}>
                      {existingMarket ? "Open market" : isSelected ? "Selected" : "Use this"}
                    </span>
                  </button>
                );
              })}
            </div>

            {candidates.length > CREATE_IDEA_PAGE_SIZE && (
              <div className="market-result-pagination" aria-label="Market idea pages">
                <button
                  className="secondary"
                  type="button"
                  disabled={visibleCandidatePage === 0}
                  onClick={() => setCandidatePage(Math.max(0, visibleCandidatePage - 1))}
                >
                  Previous
                </button>
                <span>
                  {visibleCandidatePage + 1} / {candidatePageCount}
                </span>
                <button
                  className="secondary"
                  type="button"
                  disabled={visibleCandidatePage >= candidatePageCount - 1}
                  onClick={() => setCandidatePage(Math.min(candidatePageCount - 1, visibleCandidatePage + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </section>

          <aside className="create-draft-card">
            {selectedCandidate ? (
              <>
                <form className="create-draft-body" onSubmit={onSubmit}>
                  <div className="create-draft-question">
                    <span>I know what you meant</span>
                    <h3>{form.question}</h3>
                  </div>

                  <div className="create-outcome-grid" aria-label="Outcomes">
                    <div>
                      <strong>Yes</strong>
                      <p>The event in the question happens before the close time.</p>
                    </div>
                    <div>
                      <strong>No</strong>
                      <p>The event does not happen, or the result clearly says otherwise.</p>
                    </div>
                  </div>

                  <div className="create-draft-sections">
                    <div className="create-field">
                      <label>Rules</label>
                      <p>{selectedCandidate.description}</p>
                    </div>
                    <label className="create-field">
                      Where to check the result
                      <textarea
                        disabled
                        readOnly
                        value={form.resolutionSource}
                        rows={3}
                      />
                    </label>
                    <label className="create-field">
                      Invalid conditions
                      <textarea
                        disabled
                        readOnly
                        value={form.invalidConditions}
                        rows={4}
                      />
                    </label>
                  </div>

                  <div className="create-field-split">
                    <label>
                      Money to start the market
                      <input
                        inputMode="decimal"
                        type="number"
                        min={CREATE_MIN_INITIAL_LIQUIDITY_USDC}
                        step="0.000001"
                        value={form.initialLiquidity}
                        onChange={(event) => updateField("initialLiquidity", event.target.value)}
                      />
                      <span>Minimum {CREATE_MIN_INITIAL_LIQUIDITY_USDC} USDC. The first money available when people join or trade.</span>
                    </label>
                    <label>
                      Safety deposit
                      <input
                        inputMode="decimal"
                        type="number"
                        min={CREATE_MIN_CREATION_BOND_USDC}
                        step="0.000001"
                        value={form.creationBond}
                        onChange={(event) => updateField("creationBond", event.target.value)}
                      />
                      <span>Minimum {CREATE_MIN_CREATION_BOND_USDC} USDC. You get it back when the result is clear.</span>
                    </label>
                  </div>

                  <div className="create-field">
                    <label>Close time</label>
                    <p>{formatDate(new Date(form.closeTime).toISOString())}</p>
                  </div>

                  <div className="receipt-note">
                    When the market ends, iknow agents check these details and mark it Yes, No, or Invalid.
                  </div>

                  {error && <p className="create-error">{error}</p>}

                  {draftPreview ? (
                    <div ref={readyPanelRef}>
                      <DraftPreview preview={draftPreview} onCreate={createLocalMarket} txStatus={txStatus} />
                    </div>
                  ) : (
                    <button className="create-primary" type="submit">
                      Review details
                    </button>
                  )}
                </form>
              </>
            ) : (
              <div className="create-empty-canvas">
                <span>No market selected</span>
                <h2>Pick an idea and I’ll shape it into a market.</h2>
                <p>
                  Suggestions and search live on the left. Once you choose one, this side becomes the market draft with
                  outcomes, rules, result source, and funding.
                </p>
              </div>
            )}
          </aside>
        </section>
      </section>
    </>
  );
}

function MugMascot() {
  return (
    <div className="create-mascot" aria-hidden="true">
      <span className="create-mascot-handle" />
      <span className="create-mascot-smirk" />
    </div>
  );
}

function shortMarketTitle(question: string) {
  const title = question.replace(/\?$/, "");
  if (title.length <= 58) {
    return title;
  }

  const clipped = title.slice(0, 58);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 38 ? lastSpace : 58)}...`;
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
  if (!preview && !txStatus) {
    return null;
  }

  const isErrorStatus = Boolean(
    txStatus &&
      ["failed", "not loaded", "could not", "revert", "insufficient", "must"].some((token) =>
        txStatus.toLowerCase().includes(token),
      ),
  );

  return (
    <div className="create-ready-panel">
      {preview && (
        <>
          <div>
            <span>Ready to start</span>
            <h3>Ready to create</h3>
            <p>
              You provide {formatUsdcUnits(preview.factoryArgs.initialLiquidity)} to start and keep a{" "}
              {formatUsdcUnits(preview.factoryArgs.creationBond)} safety deposit.
            </p>
          </div>

          <button className="create-primary" type="button" onClick={onCreate}>
            Create market on iknow
          </button>

          <details className="create-technical-details">
            <summary>Create details</summary>
            <dl className="compact-list">
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
                <dd>{formatDate(new Date(preview.factoryArgs.closeTime * 1000).toISOString())}</dd>
              </div>
            </dl>
          </details>
        </>
      )}
      {txStatus && <p className={isErrorStatus ? "create-error" : "create-success"}>{txStatus}</p>}
    </div>
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
          <p className="eyebrow">Profile</p>
          <h1>Your iknow</h1>
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
