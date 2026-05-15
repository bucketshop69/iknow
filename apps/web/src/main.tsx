import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">iknow</p>
        <h1>AMM prediction markets on Arc.</h1>
        <p>
          Create fully collateralized YES/NO markets, seed USDC liquidity, and
          settle outcomes with transparent evidence.
        </p>
      </section>

      <section className="grid">
        <article>
          <span>Create</span>
          <h2>Launch a market</h2>
          <p>Draft a question, define resolution rules, and seed liquidity.</p>
        </article>
        <article>
          <span>Trade</span>
          <h2>Buy YES or NO</h2>
          <p>Trade through a market AMM backed by USDC complete sets.</p>
        </article>
        <article>
          <span>Resolve</span>
          <h2>Redeem winners</h2>
          <p>Finalize outcomes and redeem winning shares for USDC.</p>
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
