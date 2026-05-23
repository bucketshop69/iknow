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
import { curatedMarketTags, fetchImportCandidates, marketIdeaSuggestions, reviewImportCandidate } from "./importMarkets";
import { iknowTheme } from "./tokens";
import { arcTestnetChain } from "./wagmi";
import type {
  CreateDraftInput,
  DevActor,
  EvidenceBriefReadModel,
  EvidenceInvalidCheckReadModel,
  MarketLifecycleReadback,
  MarketUserState,
  MarketImportCandidate,
  MarketReadModel,
  PortfolioPosition,
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

const friendlyErrorMessage = (message: string) => {
  const lower = message.toLowerCase();

  if (/invalidaddress|invalid address/.test(lower)) {
    return "Connect your wallet to see your position and send Arc Testnet actions.";
  }
  if (lower.includes("user rejected") || lower.includes("rejected the request")) {
    return "Transaction cancelled in your wallet.";
  }
  if (lower.includes("failed to fetch") || lower.includes("http request failed") || lower.includes("network")) {
    return "Network or RPC is unavailable. Refresh and try again.";
  }
  if (lower.includes("insufficient")) {
    return "Not enough balance for this action.";
  }
  if (lower.includes("revert") || lower.includes("execution reverted")) {
    return "The contract rejected this action. Check the amount, wallet balance, and market status.";
  }

  return message.length > 180 ? "This action could not be completed. Check the market status and try again." : message;
};

const looksLikeErrorStatus = (message: string) =>
  ["failed", "must", "not loaded", "unknown", "greater", "insufficient", "revert", "invalid", "unavailable", "could not"].some((token) =>
    message.toLowerCase().includes(token),
  );

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

const confidencePercent = (value: number | null) => (value === null ? 0 : Math.max(0, Math.min(100, Math.round(value * 100))));

const formatEvidenceTimestamp = (value?: string) => {
  if (!value) {
    return "Timestamp pending";
  }

  return formatDate(value);
};

const splitSentences = (value: string) =>
  value
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

const compactRuleText = (value: string, maxSentences = 2) => {
  const sentences = splitSentences(value);
  const compact = sentences.slice(0, maxSentences).join(" ");

  return compact || value;
};

const evidencePlanItems = (resolutionSource: string) => {
  const [, plan = ""] = resolutionSource.split(/Evidence plan:/i);
  if (!plan.trim()) {
    return [];
  }

  return plan
    .split(/(?=(?:FIFA|Official|Major|Check|Verify|Monitor|Cross-reference|Consensus|Source|Public)\b)|[;\n]/)
    .map((item) => item.trim().replace(/[. ]+$/g, ""))
    .filter((item) => item.length > 8)
    .slice(0, 4);
};

const uniqueRules = (items: string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

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
            isWalletReady={actorId !== "wallet" || Boolean(connectedWalletAddress && activeWalletClient)}
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
            chainName={surface.chainName || "Arc Testnet"}
            isWalletReady={actorId !== "wallet" || Boolean(connectedWalletAddress && activeWalletClient)}
            refreshKey={chainRefreshKey}
            onTransactionConfirmed={refreshChainReadbacks}
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
  isWalletReady,
  refreshKey,
  onTransactionConfirmed,
  onBack,
}: {
  market?: MarketReadModel;
  actorId: string;
  dataSource: ReturnType<typeof createMarketDataSource>;
  isWalletReady: boolean;
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

  const invalidConditions = uniqueRules(market.invalidConditions);
  const visibleInvalidConditions = invalidConditions.slice(0, 4);
  const hiddenInvalidConditions = invalidConditions.slice(4);
  const sourceSummary = compactRuleText(market.resolutionSource);
  const evidenceItems = evidencePlanItems(market.resolutionSource);

  return (
    <section className="market-detail-workspace">
      <div className="market-detail-main">
        <section className="market-hero">
          {(market.imageUrl || market.sourceIdea?.imageUrl) && (
            <img className="market-hero-image" src={market.imageUrl ?? market.sourceIdea?.imageUrl} alt="" />
          )}
          <div className="market-detail-pills">
            <span className="status">{market.status}</span>
            <span className="status">Closes {formatDate(market.closeTime)}</span>
            {market.sourceIdea?.provider && <span className="status">Source</span>}
          </div>
          <p className="eyebrow">Market detail</p>
          <h1>{market.question}</h1>
          <button className="secondary market-back-button" onClick={onBack}>
            Back to markets
          </button>
        </section>

        <section className="market-price-grid" aria-label="Market prices">
          <div className="market-price-card yes">
            <span>YES</span>
            <strong>{Math.round(market.yesPrice * 100)}¢</strong>
            <small>Current price</small>
          </div>
          <div className="market-price-card no">
            <span>NO</span>
            <strong>{Math.round(market.noPrice * 100)}¢</strong>
            <small>Other side</small>
          </div>
        </section>

        <section className="market-detail-section rules-brief">
          <div className="section-header">
            <div>
              <h2>What this means</h2>
              <p>How the market gets judged.</p>
            </div>
          </div>

          <div className="rule-hero">
            <div>
              <span>Source of truth</span>
              <strong>{sourceSummary}</strong>
              {evidenceItems.length > 0 && (
                <div className="rule-source-stack" aria-label="Evidence plan">
                  {evidenceItems.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              )}
            </div>
            <details className="rule-full-details">
              <summary>Full rules</summary>
              <p>{market.resolutionSource}</p>
            </details>
          </div>

          <div className="rule-strips">
            <details className="rule-strip yes">
              <summary>
                <span>YES</span>
                <strong>Wins if the event in the question happens.</strong>
              </summary>
              <p>Agents verify the result against the source above.</p>
            </details>
            <details className="rule-strip no">
              <summary>
                <span>NO</span>
                <strong>Wins if the event does not happen.</strong>
              </summary>
              <p>The YES condition is not met before the market closes.</p>
            </details>
            <details className="rule-strip invalid">
              <summary>
                <span>INVALID</span>
                <strong>Used only for clear edge cases.</strong>
              </summary>
              {visibleInvalidConditions.length > 0 ? (
                <ul>
                  {visibleInvalidConditions.map((condition) => (
                    <li key={condition}>{condition}</li>
                  ))}
                  {hiddenInvalidConditions.map((condition) => (
                    <li key={condition}>{condition}</li>
                  ))}
                </ul>
              ) : (
                <p>No invalid conditions listed.</p>
              )}
            </details>
          </div>
        </section>

        <section className="market-detail-section">
          <div className="section-header">
            <div>
              <h2>Market money</h2>
              <p>The pool helps people join either side without turning this into a spreadsheet party.</p>
            </div>
          </div>
          <div className="money-panel">
            <div>
              <strong>Providers earn when people trade on this market.</strong>
              <p>Funded money can move up or down before the result because the market keeps balancing YES and NO.</p>
            </div>
            <div className="money-stats">
              <Metric label="Funded pool" value={market.liquidity} />
              <Metric label="24h volume" value={market.volume24h} />
              <Metric label="YES reserve" value={market.yesReserve} />
              <Metric label="NO reserve" value={market.noReserve} />
            </div>
          </div>
        </section>

        <EvidenceBriefPanel
          actorId={actorId}
          market={market}
          dataSource={dataSource}
          refreshKey={refreshKey}
          onTransactionConfirmed={onTransactionConfirmed}
        />
        <MarketLifecycleSection actorId={actorId} market={market} dataSource={dataSource} refreshKey={refreshKey} />
        <MarketTechnicalDetails market={market} />
      </div>

      <MarketActionPanel
        actorId={actorId}
        market={market}
        dataSource={dataSource}
        isWalletReady={isWalletReady}
        refreshKey={refreshKey}
        onTransactionConfirmed={onTransactionConfirmed}
      />
    </section>
  );
}

function MarketTechnicalDetails({ market }: { market: MarketReadModel }) {
  return (
    <details className="market-detail-section technical-details">
      <summary>
        Resolver tools and technical record
        <span>Hidden by default so traders and funders do not have to parse admin controls.</span>
      </summary>
      <div className="technical-grid technical-grid-single">
        <div className="technical-card">
          <strong>Market record</strong>
          <MarketRecordPanel market={market} />
        </div>
      </div>
    </details>
  );
}

function MarketRecordPanel({ market }: { market: MarketReadModel }) {
  return (
    <dl className="market-record-grid">
      <div>
        <dt>Market address</dt>
        <dd title={market.address}>{shortAddress(market.address)}</dd>
      </div>
      <div>
        <dt>Spec hash</dt>
        <dd title={market.specHash}>{shortAddress(market.specHash)}</dd>
      </div>
      <div>
        <dt>Metadata URI</dt>
        <dd title={market.metadataURI}>{market.metadataURI}</dd>
      </div>
      {market.sourceIdea?.externalId && (
        <div>
          <dt>External idea ID</dt>
          <dd title={market.sourceIdea.externalId}>{market.sourceIdea.externalId}</dd>
        </div>
      )}
    </dl>
  );
}

function MarketLifecycleSection({
  actorId,
  market,
  dataSource,
  refreshKey,
}: {
  actorId: string;
  market: MarketReadModel;
  dataSource: ReturnType<typeof createMarketDataSource>;
  refreshKey: number;
}) {
  const [lifecycle, setLifecycle] = useState<MarketLifecycleReadback | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    dataSource
      .readMarketLifecycle(actorId, market.id)
      .then((nextLifecycle) => {
        if (!cancelled) {
          setLifecycle(nextLifecycle);
          setStatus(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setLifecycle(null);
          setStatus(caught instanceof Error ? caught.message : "Lifecycle unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actorId, dataSource, market.id, refreshKey]);

  const finalLabel =
    lifecycle?.state === "Resolved"
      ? `Resolved ${lifecycle.finalOutcome}`
      : lifecycle?.state === "Resolution proposed"
        ? `Proposed ${lifecycle.proposedOutcome}`
        : lifecycle?.state ?? market.status;

  return (
    <section className="market-detail-section">
      <div className="section-header">
        <div>
          <h2>Activity</h2>
          <p>The lifecycle for this market.</p>
        </div>
        <span className="status">{finalLabel}</span>
      </div>
      <div className="activity-list">
        <div className="activity-row">
          <div>
            <strong>Market opened</strong>
            <p>Address {shortAddress(market.address)}</p>
          </div>
          <span className="status">Live</span>
        </div>
        <div className="activity-row">
          <div>
            <strong>Close time</strong>
            <p>{formatDate(market.closeTime)}</p>
          </div>
          <span className="status">{lifecycle?.canClose ? "Ready to close" : "Waiting"}</span>
        </div>
        <div className="activity-row">
          <div>
            <strong>Resolution</strong>
            <p>
              {lifecycle?.evidenceURI
                ? `Evidence posted: ${lifecycle.evidenceURI}`
                : "Receipts appear here when the market is ready to resolve."}
            </p>
          </div>
          <span className="status">{lifecycle?.finalOutcome ?? "Unresolved"}</span>
        </div>
      </div>
      {status && <p className="error-text">{status}</p>}
    </section>
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
      setStatus(caught instanceof Error ? friendlyErrorMessage(caught.message) : "Prepare evidence packet failed");
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
      setStatus(caught instanceof Error ? friendlyErrorMessage(caught.message) : "Fetch evidence packet failed");
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
      setStatus(caught instanceof Error ? friendlyErrorMessage(caught.message) : "Propose with evidence failed");
    }
  };

  const isResolverActor = actorId === "resolver";
  const canPrepare = lifecycle?.state === "Closed" || Boolean(lifecycle?.canPropose);
  const canPropose = Boolean(isResolverActor && lifecycle?.canPropose && brief && brief.suggestedOutcome !== "UNKNOWN");
  const verdict = brief?.suggestedOutcome ?? (lifecycle?.finalOutcome !== "Unresolved" ? lifecycle?.finalOutcome : lifecycle?.proposedOutcome);
  const resolverStage =
    lifecycle?.state === "Resolved"
      ? "Finalized"
      : lifecycle?.state === "Resolution proposed"
        ? "Challenge window"
        : brief
          ? "Evidence ready"
          : canPrepare
            ? "Ready for evidence"
            : "Waiting for close";
  const panelMode =
    lifecycle?.state === "Resolved" ? "finalized" : lifecycle?.state === "Resolution proposed" ? "proposed" : brief ? "prepared" : "waiting";
  const sourceCount = brief?.evidenceLinks.length ?? 0;
  const checkSummary = summarizeInvalidChecks(brief?.invalidChecks ?? []);

  return (
    <section className={`market-detail-section evidence-card receipt-section evidence-card-${panelMode}`}>
      <div className="section-header">
        <div>
          <h2>Receipts</h2>
          <p>Resolver evidence, policy checks, and packet-backed settlement controls.</p>
        </div>
        <span className="status">{resolverStage}</span>
      </div>

      <div className="resolver-dashboard">
        <ResolverTimeline lifecycle={lifecycle} brief={brief} market={market} />

        <div className="verdict-card">
          <div>
            <span>{lifecycle?.state === "Resolved" ? "Final outcome" : "Agent verdict"}</span>
            <strong>{verdict && verdict !== "Unresolved" ? verdict : "Pending"}</strong>
            <p>
              {brief
                ? `${brief.agentId} generated this packet ${formatEvidenceTimestamp(brief.generatedAt).toLowerCase()}.`
                : "Prepare or fetch a packet to light up the evidence record."}
            </p>
          </div>
          <div className="confidence-ring" style={{ "--confidence": `${confidencePercent(brief?.confidence ?? null)}%` } as CSSProperties}>
            <strong>{formatConfidence(brief?.confidence ?? null)}</strong>
            <span>confidence</span>
          </div>
          <div className="verdict-meta-grid">
            <div>
              <span>Policy</span>
              <strong>{brief?.policyStatus ?? "Pending"}</strong>
            </div>
            <div>
              <span>Sources</span>
              <strong>{sourceCount}</strong>
            </div>
            <div>
              <span>Invalid checks</span>
              <strong>{checkSummary}</strong>
            </div>
          </div>
        </div>
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
      {status && <p className={looksLikeErrorStatus(status) ? "error-text" : "status-text"}>{status}</p>}

      {brief ? (
        <EvidenceBriefView brief={brief} lifecycle={lifecycle} />
      ) : (
        <div className="evidence-empty-state">
          <strong>Evidence packet not loaded yet</strong>
          <p>Use Prepare packet for the current market, or Fetch packet with a saved evidence id or URI.</p>
        </div>
      )}
    </section>
  );
}

function ResolverTimeline({
  lifecycle,
  brief,
  market,
}: {
  lifecycle: MarketLifecycleReadback | null;
  brief: EvidenceBriefReadModel | null;
  market: MarketReadModel;
}) {
  const state = lifecycle?.state ?? market.status;
  const steps = [
    {
      key: "waiting",
      label: "Waiting",
      detail: `Closes ${formatDate(market.closeTime)}`,
      status: state === "Open" || state === "Closing soon" ? "active" : "done",
    },
    {
      key: "closed",
      label: "Closed",
      detail: lifecycle?.canClose ? "Ready to close on-chain" : state === "Open" ? "Close window pending" : "Close readback complete",
      status: state === "Closed" ? "active" : state === "Resolution proposed" || state === "Resolved" ? "done" : "waiting",
    },
    {
      key: "evidence",
      label: "Evidence",
      detail: brief ? `Packet ${brief.id}` : lifecycle?.evidenceURI ? lifecycle.evidenceURI : "Packet pending",
      status: brief || lifecycle?.evidenceURI ? "done" : state === "Closed" ? "active" : "waiting",
    },
    {
      key: "proposed",
      label: "Proposed",
      detail: lifecycle?.proposedOutcome && lifecycle.proposedOutcome !== "Unresolved" ? lifecycle.proposedOutcome : "Resolver has not proposed",
      status: state === "Resolution proposed" ? "active" : state === "Resolved" ? "done" : "waiting",
    },
    {
      key: "challenge",
      label: "Challenge",
      detail: lifecycle?.finalizeAfter ? `Finalize after ${formatDate(lifecycle.finalizeAfter)}` : "Challenge clock starts after proposal",
      status: state === "Resolution proposed" ? "active" : state === "Resolved" ? "done" : "waiting",
    },
    {
      key: "finalized",
      label: "Finalized",
      detail: lifecycle?.finalOutcome && lifecycle.finalOutcome !== "Unresolved" ? lifecycle.finalOutcome : "Awaiting final outcome",
      status: state === "Resolved" ? "done" : "waiting",
    },
  ];

  return (
    <ol className="resolver-timeline" aria-label="Resolver evidence timeline">
      {steps.map((step) => (
        <li className={`resolver-timeline-step ${step.status}`} key={step.key}>
          <span />
          <div>
            <strong>{step.label}</strong>
            <p>{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function summarizeInvalidChecks(checks: EvidenceInvalidCheckReadModel[]) {
  if (checks.length === 0) {
    return "Pending";
  }
  const failed = checks.filter((check) => check.status === "fail").length;
  const unknown = checks.filter((check) => check.status === "unknown").length;
  if (failed > 0) {
    return `${failed} fail`;
  }
  if (unknown > 0) {
    return `${unknown} warn`;
  }

  return "All pass";
}

function EvidenceBriefView({
  brief,
  lifecycle,
}: {
  brief: EvidenceBriefReadModel;
  lifecycle: MarketLifecycleReadback | null;
}) {
  const outcomeLabel =
    lifecycle?.state === "Resolved" && lifecycle.finalOutcome !== "Unresolved"
      ? lifecycle.finalOutcome
      : lifecycle?.state === "Resolution proposed" && lifecycle.proposedOutcome !== "Unresolved"
        ? lifecycle.proposedOutcome
        : brief.suggestedOutcome;
  const outcomeMode = lifecycle?.state === "Resolved" ? "finalized" : lifecycle?.state === "Resolution proposed" ? "proposed" : "suggested";

  return (
    <div className="evidence-brief">
      <div className={`settlement-state ${outcomeMode}`}>
        <span>{outcomeMode === "finalized" ? "Finalized on-chain" : outcomeMode === "proposed" ? "Proposed, challengeable" : "Suggested by agent"}</span>
        <strong>{outcomeLabel}</strong>
        <code>{brief.evidenceURI}</code>
      </div>

      <div className="evidence-columns">
        <EvidenceList title="Extracted facts" emptyLabel="No facts returned.">
          {brief.facts.map((fact) => (
            <li className="fact-row" key={`${fact.label}-${fact.value}`}>
              <strong>{fact.label}</strong>
              <span>{fact.value}</span>
            </li>
          ))}
        </EvidenceList>

        <EvidenceList title="Source stack" emptyLabel="No evidence links returned.">
          {brief.evidenceLinks.map((link) => (
            <li className="source-row" key={`${link.label}-${link.url}`}>
              <div>
                <strong>{link.label}</strong>
                <small>{link.source ?? "Evidence source"} / {formatEvidenceTimestamp(link.timestamp ?? brief.generatedAt)}</small>
              </div>
              <span>
                {isUrl(link.url) ? (
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {link.url}
                  </a>
                ) : (
                  link.url
                )}
              </span>
            </li>
          ))}
        </EvidenceList>

        <EvidenceList title="Invalid checks" emptyLabel="No invalid checks returned.">
          {brief.invalidChecks.map((check) => (
            <li className={`check-row ${check.status}`} key={`${check.label}-${check.status}`}>
              <strong>
                <span className={`check-status ${check.status}`}>{check.status === "unknown" ? "warn" : check.status}</span>
                {check.label}
              </strong>
              <span>
                {check.note ?? (check.status === "pass" ? "No invalid trigger found." : "Needs resolver review.")}
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

function TicketActionProgress({
  phase,
  label,
}: {
  phase: "idle" | "pending" | "confirmed" | "error";
  label: string | null;
}) {
  if (phase === "idle") {
    return null;
  }

  const walletStepClass = phase === "error" ? "error" : "done";
  const transactionStepClass = phase === "pending" ? "active" : phase === "confirmed" ? "done" : phase === "error" ? "error" : "";
  const confirmedCopy = label?.startsWith("Claim") ? "Claim confirmed. Refreshing this market." : "Confirmed. Refreshing this market.";

  return (
    <div className="ticket-action-progress" aria-live="polite">
      <div className={`ticket-step ${walletStepClass}`}>
        <span>1</span>
        <div>
          <strong>Wallet approval</strong>
          <p>{phase === "pending" ? "Approve in your wallet." : "Wallet step checked."}</p>
        </div>
      </div>
      <div className={`ticket-step ${transactionStepClass}`}>
        <span>2</span>
        <div>
          <strong>{label ?? "Action"}</strong>
          <p>
            {phase === "pending"
              ? "Confirming on Arc Testnet."
              : phase === "confirmed"
                ? confirmedCopy
                : "Could not complete this action."}
          </p>
        </div>
      </div>
    </div>
  );
}

function MarketActionPanel({
  actorId,
  market,
  dataSource,
  isWalletReady,
  refreshKey,
  onTransactionConfirmed,
}: {
  actorId: string;
  market: MarketReadModel;
  dataSource: ReturnType<typeof createMarketDataSource>;
  isWalletReady: boolean;
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
  const [activeTicketTab, setActiveTicketTab] = useState<"bet" | "fund">("bet");
  const [fundMode, setFundMode] = useState<"add" | "remove">("add");
  const [actionPhase, setActionPhase] = useState<"idle" | "pending" | "confirmed" | "error">("idle");
  const [actionLabel, setActionLabel] = useState<string | null>(null);

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
        setReadbackStatus(caught instanceof Error ? friendlyErrorMessage(caught.message) : "Position readback unavailable");
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
        setQuoteStatus(caught instanceof Error ? friendlyErrorMessage(caught.message) : "Quote unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource, market.id, refreshKey, slippageBps, tradeAction, tradeAmount]);

  const runAction = async (label: string, action: () => Promise<string>) => {
    setActionLabel(label);
    setActionPhase("pending");
    setStatus(`${label} pending...`);
    try {
      const hash = await action();
      setActionPhase("confirmed");
      setStatus(`${label} confirmed: ${shortAddress(hash)}`);
      onTransactionConfirmed();
    } catch (caught) {
      setActionPhase("error");
      setStatus(caught instanceof Error ? friendlyErrorMessage(caught.message) : `${label} failed`);
    }
  };

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

  const tradeSide = tradeAction.endsWith("YES") ? "YES" : "NO";
  const tradeMode = tradeAction.startsWith("BUY") ? "BUY" : "SELL";
  const setTradeSide = (side: "YES" | "NO") => setTradeAction(`${tradeMode}_${side}` as TradeAction);
  const setTradeMode = (mode: "BUY" | "SELL") => setTradeAction(`${mode}_${tradeSide}` as TradeAction);
  const isTradeQuoteError = Boolean(quoteStatus && !quoteStatus.startsWith("Refreshing"));
  const friendlyReadbackStatus = readbackStatus ? friendlyErrorMessage(readbackStatus) : null;
  const sideLabel = tradeSide === "YES" ? "Yes" : "No";
  const tradeCtaLabel = `${tradeMode === "BUY" ? "Buy" : "Sell"} ${sideLabel}`;
  const potentialPayoutLabel =
    tradeMode === "BUY" && tradeQuote ? tradeQuote.outputLabel.replace(/\s(YES|NO)$/i, " USDC") : "-";
  const fundedLabel = (userState?.lpShares ?? "0 LP").replace(" LP", " funded shares");
  const pendingAction = actionPhase === "pending";
  const marketPrice = (tradeSide === "YES" ? market.yesPrice : market.noPrice) * 100;
  const quoteOutputNumber = tradeQuote ? Number(BigInt(tradeQuote.amountOut)) / 1_000_000 : 0;
  const tradeAmountNumber = Number(tradeAmount);
  const effectivePrice =
    tradeQuote && quoteOutputNumber > 0 && Number.isFinite(tradeAmountNumber) && tradeAmountNumber > 0
      ? tradeMode === "BUY"
        ? (tradeAmountNumber / quoteOutputNumber) * 100
        : (quoteOutputNumber / tradeAmountNumber) * 100
      : null;
  const priceImpactLabel =
    effectivePrice === null
      ? "-"
      : `${effectivePrice.toFixed(1)}¢ effective, ${(effectivePrice - marketPrice >= 0 ? "+" : "")}${(
          effectivePrice - marketPrice
        ).toFixed(1)}¢ vs market`;
  const actionBlockReason = !isWalletReady
    ? "Connect your wallet before sending an Arc Testnet action."
    : !isOpenMarket
      ? `This market is ${lifecycleStatus.toLowerCase()}, so betting and funding are closed.`
      : null;
  const canSendUserAction = !actionBlockReason && !pendingAction;
  const settlementBlockReason = !isWalletReady ? "Connect your wallet before claiming from Arc Testnet." : null;
  const canSendSettlementAction = !settlementBlockReason && !pendingAction;
  const fundAmountLabel = `${liquidityAmount || "0"} USDC`;
  const removeSharesLabel = `${removeShares || "0"} funded shares`;
  const userHasCall = Boolean(userState && (BigInt(userState.yesBalanceRaw) > 0n || BigInt(userState.noBalanceRaw) > 0n));
  const settlementStatus = lifecycle?.canRedeem
    ? `Claim ${lifecycle.redeemable}`
    : lifecycle?.state === "Resolved"
      ? userHasCall
        ? "No winnings to claim"
        : "Winnings claimed"
      : lifecycle?.state === "Resolution proposed" || lifecycle?.state === "Closed"
        ? "Waiting for result"
        : "Live";

  return (
    <aside className="market-ticket">
      <div className="ticket-head">
        <span>Market actions</span>
        <h2>Bet or fund market</h2>
      </div>
      <div className="ticket-body">
        <div className="ticket-tabs" aria-label="Market action">
          <button
            type="button"
            className={activeTicketTab === "bet" ? "active" : ""}
            onClick={() => setActiveTicketTab("bet")}
          >
            Bet
          </button>
          <button
            type="button"
            className={activeTicketTab === "fund" ? "active" : ""}
            onClick={() => setActiveTicketTab("fund")}
          >
            Fund market
          </button>
        </div>

        {activeTicketTab === "bet" ? (
          <div className="ticket-panel">
            <div className="side-buttons">
              <button
                type="button"
                className={tradeSide === "YES" ? "active yes" : ""}
                onClick={() => setTradeSide("YES")}
              >
                YES
              </button>
              <button
                type="button"
                className={tradeSide === "NO" ? "active no" : ""}
                onClick={() => setTradeSide("NO")}
              >
                NO
              </button>
            </div>

            <div className="trade-mode-buttons">
              <button type="button" className={tradeMode === "BUY" ? "active" : ""} onClick={() => setTradeMode("BUY")}>
                Buy
              </button>
              <button type="button" className={tradeMode === "SELL" ? "active" : ""} onClick={() => setTradeMode("SELL")}>
                Sell
              </button>
            </div>

            <label>
              {tradeMode === "BUY" ? "You pay" : "You sell"}
              <input inputMode="decimal" value={tradeAmount} onChange={(event) => setTradeAmount(event.target.value)} />
            </label>
            <label>
              Slippage %
              <input
                inputMode="decimal"
                value={String(slippageBps / 100)}
                onChange={(event) => updateSlippage(event.target.value)}
              />
            </label>
            <dl className="ticket-quote">
              <div>
                <dt>{tradeMode === "BUY" ? `You get about` : "You receive about"}</dt>
                <dd>{tradeQuote?.outputLabel ?? "-"}</dd>
              </div>
              <div>
                <dt>{tradeMode === "BUY" ? `If ${sideLabel} wins` : "You sell"}</dt>
                <dd>{tradeMode === "BUY" ? potentialPayoutLabel : tradeQuote?.inputLabel ?? "-"}</dd>
              </div>
              <div>
                <dt>Fee</dt>
                <dd>{tradeQuote?.feeLabel ?? "-"}</dd>
              </div>
              <div>
                <dt>Price impact</dt>
                <dd>{priceImpactLabel}</dd>
              </div>
              <div>
                <dt>Minimum received</dt>
                <dd>{tradeQuote?.minOutputLabel ?? "-"}</dd>
              </div>
            </dl>
            {quoteStatus && <p className={isTradeQuoteError ? "error-text" : "status-text"}>{quoteStatus}</p>}
            <TicketActionProgress phase={actionPhase} label={actionLabel} />
            {actionBlockReason && <p className="ticket-blocker">{actionBlockReason}</p>}
            <button disabled={!canSendUserAction} onClick={() => runTrade(tradeAction)}>
              {tradeCtaLabel}
            </button>
            <p className="helper">If you called it right, claim after receipts are posted and the result is in.</p>
          </div>
        ) : (
          <div className="ticket-panel">
            <p className="helper">
              Put USDC into this market so other people can buy Yes or No. You earn a share of fees when people trade.
            </p>
            <div className="trade-mode-buttons">
              <button type="button" className={fundMode === "add" ? "active" : ""} onClick={() => setFundMode("add")}>
                Add money
              </button>
              <button type="button" className={fundMode === "remove" ? "active" : ""} onClick={() => setFundMode("remove")}>
                Remove
              </button>
            </div>
            {fundMode === "add" ? (
              <label>
                Money to fund
                <input
                  inputMode="decimal"
                  value={liquidityAmount}
                  onChange={(event) => setLiquidityAmount(event.target.value)}
                />
              </label>
            ) : (
              <label>
                Funded shares to remove
                <input inputMode="decimal" value={removeShares} onChange={(event) => setRemoveShares(event.target.value)} />
              </label>
            )}
            <div className="position-grid">
              <Metric label="Funded shares" value={userState ? fundedLabel : friendlyReadbackStatus ? "Unavailable" : "0 funded shares"} />
              <Metric
                label="Fees earned"
                value={userState?.pendingLpFees ?? (friendlyReadbackStatus ? "Unavailable" : "0 USDC")}
              />
            </div>
            <dl className="ticket-quote">
              <div>
                <dt>{fundMode === "add" ? "You add" : "You remove"}</dt>
                <dd>{fundMode === "add" ? fundAmountLabel : removeSharesLabel}</dd>
              </div>
              <div>
                <dt>Current market pool</dt>
                <dd>{market.liquidity}</dd>
              </div>
              <div>
                <dt>Your funded shares</dt>
                <dd>{userState ? fundedLabel : friendlyReadbackStatus ? "Unavailable" : "0 funded shares"}</dd>
              </div>
              <div>
                <dt>Fees earned</dt>
                <dd>{userState?.pendingLpFees ?? (friendlyReadbackStatus ? "Unavailable" : "0 USDC")}</dd>
              </div>
            </dl>
            <TicketActionProgress phase={actionPhase} label={actionLabel} />
            {actionBlockReason && <p className="ticket-blocker">{actionBlockReason}</p>}
            <button
              disabled={!canSendUserAction}
              onClick={() =>
                fundMode === "add"
                  ? runAction("Fund market", () => dataSource.executeAddLiquidity(actorId, market.id, liquidityAmount))
                  : runAction("Remove money", () => dataSource.executeRemoveLiquidity(actorId, market.id, removeShares))
              }
            >
              {fundMode === "add" ? "Fund market" : "Remove money"}
            </button>
            <p className="risk-note">
              This is not a fixed return. The amount you can withdraw can change as the market moves.
            </p>
          </div>
        )}

        <div className="ticket-position">
          <div>
            <h3>Your position in this market</h3>
            <p className="helper">Profile shows everything. This shows only what you have here.</p>
          </div>
          <dl className="compact-list">
            <div>
              <dt>Yes owned</dt>
              <dd>{userState?.yesBalance ?? (friendlyReadbackStatus ? "Unavailable" : "0 YES")}</dd>
            </div>
            <div>
              <dt>No owned</dt>
              <dd>{userState?.noBalance ?? (friendlyReadbackStatus ? "Unavailable" : "0 NO")}</dd>
            </div>
            <div>
              <dt>Funded shares</dt>
              <dd>{userState ? fundedLabel : friendlyReadbackStatus ? "Unavailable" : "0 funded shares"}</dd>
            </div>
            <div>
              <dt>Fees earned</dt>
              <dd>{userState?.pendingLpFees ?? (friendlyReadbackStatus ? "Unavailable" : "0 USDC")}</dd>
            </div>
          </dl>
        </div>
        {friendlyReadbackStatus && !userState && (
          <p className={friendlyReadbackStatus.startsWith("Refreshing") ? "status-text" : "error-text"}>
            {friendlyReadbackStatus}
          </p>
        )}

        <div className="ticket-settlement">
          <div>
            <h3>Claim after result</h3>
            <p className="helper">
              {lifecycle?.canRedeem
                ? "Receipts are posted and your winning call is ready."
                : lifecycle?.state === "Resolved"
                  ? settlementStatus
                  : "Your call can be claimed after the market resolves."}
            </p>
          </div>
          <dl className="ticket-quote">
            <div>
              <dt>Winnings</dt>
              <dd>{lifecycle?.redeemable ?? "0 USDC"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{settlementStatus}</dd>
            </div>
          </dl>
          {settlementBlockReason && <p className="ticket-blocker">{settlementBlockReason}</p>}
          <button
            disabled={!canSendSettlementAction || !lifecycle?.canRedeem}
            onClick={() => runAction("Claim winnings", () => dataSource.executeRedeem(actorId, market.id))}
          >
            Claim winnings
          </button>
        </div>

        <details className="ticket-resolution">
          <summary>
            Resolver and admin tools
            <span>{lifecycleStatus}</span>
          </summary>
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
        <div className="button-row lifecycle-actions ticket-lifecycle-actions">
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
            onClick={() => runAction("Claim winnings", () => dataSource.executeRedeem(actorId, market.id))}
          >
            Claim winnings
          </button>
          <button
            className="secondary"
            disabled={!lifecycle?.canClaimCreatorFees}
            onClick={() =>
              runAction("Claim creator earnings", () => dataSource.executeClaimCreatorFees(actorId, market.id))
            }
          >
            Claim creator earnings
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
            onClick={() => runAction("Claim safety deposit", () => dataSource.executeClaimCreationBond(actorId, market.id))}
          >
            Claim safety deposit
          </button>
        </div>
        <dl className="compact-list ticket-claim-list">
          <div>
            <dt>Winnings</dt>
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
        </details>
        {status && <p className={looksLikeErrorStatus(status) ? "error-text" : "status-text"}>{status}</p>}
      </div>
    </aside>
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
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
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
    setForm((current) => ({ ...current, [field]: value, importReview: undefined }));
    setDraftPreview(null);
    setReviewStatus(null);
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
    setReviewStatus(null);
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
      importReview: undefined,
    }));
    setDraftPreview(null);
    setReviewStatus(null);
    setError(null);
    setTxStatus(null);
  };

  const clearSelectedMarket = () => {
    setSelectedCandidate(null);
    setForm(createEmptyDraftInput(deployment, chainClockMs));
    setDraftPreview(null);
    setReviewStatus(null);
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
        importReview: form.importReview,
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
      setReviewStatus("Our agents are reviewing this market...");
      const reviewResult = await reviewImportCandidate(selectedCandidate, form);
      if (reviewResult.review.status !== "ready") {
        setError("Agents need a clearer market before creation. Try another Source market.");
        setDraftPreview(null);
        setReviewStatus(null);
        setForm((current) => ({ ...current, importReview: reviewResult.review }));
        return;
      }

      const reviewedForm = {
        ...form,
        resolutionSource: reviewResult.draftPatch.resolutionSource,
        invalidConditions: reviewResult.draftPatch.invalidConditions.join("\n"),
        importReview: reviewResult.review,
      };
      setForm(reviewedForm);
      setDraftPreview(await dataSource.buildDraftPreview(reviewedForm));
      setError(null);
      setReviewStatus(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Draft validation failed");
      setDraftPreview(null);
      setReviewStatus(null);
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
                      <span>{existingMarket ? "Already on iknow" : isSelected ? "Selected market" : "Ready to review"}</span>
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

                  {reviewStatus && <p className="create-review-status">{reviewStatus}</p>}
                  {!reviewStatus && draftPreview && form.importReview?.status === "ready" && (
                    <p className="create-review-status ready">Agents approved this market.</p>
                  )}

                  {error && <p className="create-error">{error}</p>}

                  {draftPreview ? (
                    <div ref={readyPanelRef}>
                      <DraftPreview preview={draftPreview} onCreate={createLocalMarket} txStatus={txStatus} />
                    </div>
                  ) : (
                    <button className="create-primary" type="submit" disabled={Boolean(reviewStatus)}>
                      {reviewStatus ? "Agents are reviewing..." : "Review details"}
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
  chainName,
  isWalletReady,
  refreshKey,
  onTransactionConfirmed,
  onOpenMarket,
}: {
  actorId: string;
  dataSource: ReturnType<typeof createMarketDataSource>;
  chainName: string;
  isWalletReady: boolean;
  refreshKey: number;
  onTransactionConfirmed: () => void;
  onOpenMarket: (marketId: string) => void;
}) {
  const staticPortfolio = dataSource.getPortfolio(actorId);
  const [livePortfolio, setLivePortfolio] = useState<PortfolioReadModel | null>(null);
  const [lpReadbackStatus, setLpReadbackStatus] = useState<string | null>(null);
  const [actionPhase, setActionPhase] = useState<"idle" | "pending" | "confirmed" | "error">("idle");
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [portfolioTab, setPortfolioTab] = useState<"calls" | "funding" | "created">("calls");

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
  const calls = portfolio.positions.filter((position) => hasTokenPosition(position));
  const funding = portfolio.positions.filter((position) => rawAmountIsPositive(position.lpSharesRaw));
  const createdMarkets = portfolio.positions.filter(
    (position) =>
      position.isCreator ||
      rawAmountIsPositive(position.creatorFeesRaw) ||
      rawAmountIsPositive(position.creationBondRaw) ||
      position.canClaimCreatorFees ||
      position.canClaimCreationBond,
  );
  const claimActions = portfolio.positions.flatMap((position) => claimActionsForPosition(position));
  const readyActions = claimActions.filter((action) => action.enabled);
  const lpFeeActions = funding.filter((position) => rawAmountIsPositive(position.pendingLpFeesRaw));
  const primaryReadyAction = readyActions[0];

  const runPortfolioAction = async (label: string, action: () => Promise<string>) => {
    setActionLabel(label);
    setActionPhase("pending");
    setActionStatus("Approve in your wallet");
    try {
      const hash = await action();
      setActionPhase("confirmed");
      setActionStatus(`Claim confirmed: ${shortAddress(hash)}`);
      onTransactionConfirmed();
    } catch (caught) {
      setActionPhase("error");
      setActionStatus(caught instanceof Error ? friendlyErrorMessage(caught.message) : `${label} failed`);
    }
  };

  const executeClaimAction = (action: PortfolioClaimAction) => {
    if (action.kind === "winnings") {
      return runPortfolioAction(action.label, () => dataSource.executeRedeem(actorId, action.marketId));
    }
    if (action.kind === "creator") {
      return runPortfolioAction(action.label, () => dataSource.executeClaimCreatorFees(actorId, action.marketId));
    }
    if (action.kind === "bond") {
      return runPortfolioAction(action.label, () => dataSource.executeClaimCreationBond(actorId, action.marketId));
    }
    return runPortfolioAction(action.label, () => dataSource.executeClaimProtocolFees(actorId, action.marketId));
  };

  return (
    <div className="portfolio-page">
      <section className="portfolio-hero">
        <div className="portfolio-identity">
          <div className="portfolio-avatar" aria-hidden="true">
            {portfolio.actor.name.slice(0, 1)}
          </div>
          <div>
            <p className="eyebrow">Your iknow</p>
            <h1>{portfolio.actor.name}</h1>
            <p>
              {shortAddress(portfolio.actor.address)} · {chainName} · {isWalletReady ? "Wallet ready" : "Wallet not connected"}
            </p>
          </div>
        </div>
        <div className="portfolio-hero-stats">
          <Metric label="Markets joined" value={String(calls.length)} />
          <Metric label="Markets funded" value={String(funding.length)} />
          <Metric label="Ready to claim" value={String(readyActions.length)} />
          <Metric label="USDC balance" value={portfolio.actor.usdcBalance} />
        </div>
      </section>
      {lpReadbackStatus && !livePortfolio && (
        <p className={lpReadbackStatus.startsWith("Refreshing") ? "status-text" : "error-text"}>{lpReadbackStatus}</p>
      )}

      <section className="portfolio-ready-grid" aria-label="Ready for you">
        <article className="portfolio-claim-card primary">
          <span>Ready for you</span>
          <h2>{primaryReadyAction?.amount ?? "0 USDC"}</h2>
          <p>{primaryReadyAction ? `${primaryReadyAction.label} is ready.` : "No balances are ready right now."}</p>
          <button disabled={!primaryReadyAction || !isWalletReady || actionPhase === "pending"} onClick={() => primaryReadyAction && executeClaimAction(primaryReadyAction)}>
            {primaryReadyAction?.label ?? "Nothing to claim"}
          </button>
        </article>
        <MoneyActionCard
          label="Claim winnings"
          value={portfolio.totals.winnings}
          helper="Winning resolved calls ready to collect."
          disabled={!isWalletReady || actionPhase === "pending" || !readyActions.some((action) => action.kind === "winnings")}
          onClick={() => {
            const action = readyActions.find((candidate) => candidate.kind === "winnings");
            if (action) {
              executeClaimAction(action);
            }
          }}
        />
        <MoneyActionCard
          label="Claim creator earnings"
          value={portfolio.totals.creatorEarnings}
          helper="Fees from markets you created."
          disabled={!isWalletReady || actionPhase === "pending" || !readyActions.some((action) => action.kind === "creator")}
          onClick={() => {
            const action = readyActions.find((candidate) => candidate.kind === "creator");
            if (action) {
              executeClaimAction(action);
            }
          }}
        />
        <MoneyActionCard
          label="Claim safety deposit"
          value={portfolio.totals.safetyDeposit}
          helper="Creation bond returned after valid resolution."
          disabled={!isWalletReady || actionPhase === "pending" || !readyActions.some((action) => action.kind === "bond")}
          onClick={() => {
            const action = readyActions.find((candidate) => candidate.kind === "bond");
            if (action) {
              executeClaimAction(action);
            }
          }}
        />
        <MoneyActionCard
          label="Remove funding to collect fees"
          value={portfolio.totals.lpFees}
          helper="Fees earned by funding. Remove funding from the market to collect."
          disabled={lpFeeActions.length === 0}
          onClick={() => {
            const position = lpFeeActions[0] ?? funding[0];
            if (position) {
              onOpenMarket(position.marketId);
            }
          }}
        />
      </section>
      <TicketActionProgress phase={actionPhase} label={actionLabel} />
      {actionStatus && <p className={looksLikeErrorStatus(actionStatus) ? "error-text" : "status-text"}>{actionStatus}</p>}

      <section className="portfolio-section portfolio-profile-panel">
        <div className="portfolio-section-head">
          <div>
            <h2>Your profile</h2>
            <span>Calls, funding, and markets you created in one table.</span>
          </div>
        </div>

        <div className="portfolio-tab-list" role="tablist" aria-label="Profile sections">
          <button
            className={`portfolio-tab ${portfolioTab === "calls" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={portfolioTab === "calls"}
            onClick={() => setPortfolioTab("calls")}
          >
            Your calls <span>{calls.length}</span>
          </button>
          <button
            className={`portfolio-tab ${portfolioTab === "funding" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={portfolioTab === "funding"}
            onClick={() => setPortfolioTab("funding")}
          >
            Funding <span>{funding.length}</span>
          </button>
          <button
            className={`portfolio-tab ${portfolioTab === "created" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={portfolioTab === "created"}
            onClick={() => setPortfolioTab("created")}
          >
            Created <span>{createdMarkets.length}</span>
          </button>
        </div>

        {portfolioTab === "calls" && (
          <div className="portfolio-tab-panel" role="tabpanel">
            {calls.length === 0 ? (
              <div className="empty-state inline">
                <h2>No active positions yet</h2>
              </div>
            ) : (
              <div className="portfolio-table calls">
                <div className="portfolio-table-row table-head">
                  <span>Market</span>
                  <span>Pick</span>
                  <span>Position</span>
                  <span>Status</span>
                  <span>Action</span>
                </div>
                {calls.map((position) => {
                  const winningAction = claimActionsForPosition(position).find((action) => action.kind === "winnings");
                  const hasYes = rawAmountIsPositive(position.yesSharesRaw);
                  const hasNo = rawAmountIsPositive(position.noSharesRaw);
                  const pickLabel = hasYes && hasNo ? "YES + NO" : hasYes ? "YES" : "NO";
                  const positionLabel = [
                    hasYes ? `${position.yesShares} YES` : null,
                    hasNo ? `${position.noShares} NO` : null,
                  ]
                    .filter(Boolean)
                    .join(" / ");
                  return (
                    <div className="portfolio-table-row" key={`call-${position.marketId}`}>
                      <div className="portfolio-table-market">
                        <strong>{position.marketQuestion}</strong>
                        <span>{positionCallLabel(position)}</span>
                      </div>
                      <div className="portfolio-table-cell">
                        <strong>{pickLabel}</strong>
                      </div>
                      <div className="portfolio-table-cell">
                        <strong>{positionLabel}</strong>
                        <span>shares</span>
                      </div>
                      <span className={`status ${positionStatusTone(position)}`}>{positionClaimStatus(position)}</span>
                      {winningAction?.enabled ? (
                        <button disabled={!isWalletReady || actionPhase === "pending"} onClick={() => executeClaimAction(winningAction)}>
                          Claim
                        </button>
                      ) : (
                        <button className="secondary" onClick={() => onOpenMarket(position.marketId)}>
                          View market
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {portfolioTab === "funding" && (
          <div className="portfolio-tab-panel" role="tabpanel">
            {funding.length === 0 ? (
              <div className="empty-state inline">
                <h2>No funding positions</h2>
              </div>
            ) : (
              <div className="portfolio-table funding">
                <div className="portfolio-table-row table-head">
                  <span>Market</span>
                  <span>Funded</span>
                  <span>Fees earned</span>
                  <span>Status</span>
                  <span>Action</span>
                </div>
                {funding.map((position) => (
                  <div className="portfolio-table-row" key={`funding-${position.marketId}`}>
                    <div className="portfolio-table-market">
                      <strong>{position.marketQuestion}</strong>
                      <span>Liquidity provider</span>
                    </div>
                    <div className="portfolio-table-cell">
                      <strong>{position.lpShares}</strong>
                    </div>
                    <div className="portfolio-table-cell">
                      <strong>{position.pendingLpFees}</strong>
                    </div>
                    <span className="status">{position.status}</span>
                    <button className="secondary" onClick={() => onOpenMarket(position.marketId)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {portfolioTab === "created" && (
          <div className="portfolio-tab-panel" role="tabpanel">
            {createdMarkets.length === 0 ? (
              <div className="empty-state inline">
                <h2>No creator balances</h2>
              </div>
            ) : (
              <div className="portfolio-table created">
                <div className="portfolio-table-row table-head">
                  <span>Market</span>
                  <span>Earnings</span>
                  <span>Deposit</span>
                  <span>Status</span>
                  <span>Action</span>
                </div>
                {createdMarkets.map((position) => {
                  const creatorActions = claimActionsForPosition(position).filter((action) => action.kind === "creator" || action.kind === "bond");
                  const enabledCreatorActions = creatorActions.filter((action) => action.enabled);
                  return (
                    <div className="portfolio-table-row" key={`created-${position.marketId}`}>
                      <div className="portfolio-table-market">
                        <strong>{position.marketQuestion}</strong>
                        <span>{position.status === "Resolved" ? `Resolved ${position.resolution}` : position.status}</span>
                      </div>
                      <div className="portfolio-table-cell">
                        <strong>{position.creatorFees}</strong>
                      </div>
                      <div className="portfolio-table-cell">
                        <strong>{position.creationBond}</strong>
                      </div>
                      <span className="status">{enabledCreatorActions.length > 0 ? "Ready to claim" : "Waiting"}</span>
                      <div className="portfolio-table-actions">
                        {enabledCreatorActions.map((action) => (
                          <button
                            key={`${action.kind}-${action.marketId}`}
                            disabled={!isWalletReady || actionPhase === "pending"}
                            onClick={() => executeClaimAction(action)}
                          >
                            {action.kind === "creator" ? "Claim earnings" : "Claim deposit"}
                          </button>
                        ))}
                        <button className="secondary" onClick={() => onOpenMarket(position.marketId)}>
                          View market
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

    </div>
  );
}

type PortfolioClaimAction = {
  kind: "winnings" | "creator" | "bond" | "protocol";
  label: string;
  amount: string;
  enabled: boolean;
  marketId: string;
};

function rawAmountIsPositive(value: string) {
  try {
    return BigInt(value) > 0n;
  } catch {
    return value !== "0" && value.trim() !== "";
  }
}

function hasTokenPosition(position: PortfolioPosition) {
  return rawAmountIsPositive(position.yesSharesRaw) || rawAmountIsPositive(position.noSharesRaw);
}

function positionCallLabel(position: PortfolioPosition) {
  const picked = [
    rawAmountIsPositive(position.yesSharesRaw) ? `YES ${position.yesShares}` : null,
    rawAmountIsPositive(position.noSharesRaw) ? `NO ${position.noShares}` : null,
  ].filter(Boolean);

  return picked.length > 0 ? `You picked ${picked.join(" and ")}` : "No active position";
}

function positionClaimStatus(position: PortfolioPosition) {
  if (position.canRedeem) {
    return "Ready to claim";
  }
  if (position.status === "Resolved") {
    return hasTokenPosition(position) ? "No winnings to claim" : "Winnings claimed";
  }
  if (position.status === "Closed" || position.status === "Resolution proposed") {
    return "Waiting for result";
  }
  return "Live";
}

function positionStatusTone(position: PortfolioPosition) {
  if (position.canRedeem) {
    return "yes";
  }
  if (position.status === "Resolved") {
    return "settled";
  }
  return "";
}

function claimActionsForPosition(position: PortfolioPosition): PortfolioClaimAction[] {
  return [
    {
      kind: "winnings",
      label: "Claim winnings",
      amount: position.redeemable,
      enabled: position.canRedeem,
      marketId: position.marketId,
    },
    {
      kind: "creator",
      label: "Claim creator earnings",
      amount: position.creatorFees,
      enabled: position.canClaimCreatorFees,
      marketId: position.marketId,
    },
    {
      kind: "bond",
      label: "Claim safety deposit",
      amount: position.creationBond,
      enabled: position.canClaimCreationBond,
      marketId: position.marketId,
    },
    {
      kind: "protocol",
      label: "Claim protocol fees",
      amount: position.protocolFees,
      enabled: position.canClaimProtocolFees,
      marketId: position.marketId,
    },
  ];
}

function MoneyActionCard({
  label,
  value,
  helper,
  disabled,
  onClick,
}: {
  label: string;
  value: string;
  helper: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <article className="portfolio-claim-card">
      <span>{label}</span>
      <h2>{value}</h2>
      <p>{helper}</p>
      <button className="secondary" disabled={disabled} onClick={onClick}>
        {label}
      </button>
    </article>
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
