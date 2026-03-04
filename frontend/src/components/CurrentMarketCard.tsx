import { useEffect, useState } from "react";
import type { CurrentMarketInfo } from "@/lib/types";

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  market: CurrentMarketInfo | null;
  totalAmount: number;
  totalUp: number;
  totalDown: number;
  walletCount: number;
}

export function CurrentMarketCard({
  market,
  totalAmount,
  totalUp,
  totalDown,
  walletCount,
}: Props) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  if (!market) {
    return (
      <div className="card">
        <h2>Current 5m market</h2>
        <p className="muted">No active market</p>
      </div>
    );
  }

  const secLeft =
    market.secondsLeft ?? Math.max(0, market.endTime - now);

  return (
    <div className="card">
      <h2>Current 5m market</h2>
      <div className="market-meta">
        <span className="num">{market.eventSlug}</span>
        {market.isActive && (
          <span className="countdown">Ends in {formatSeconds(secLeft)}</span>
        )}
      </div>
      <div className="market-totals">
        <div className="stat">
          <span className="stat-label">Volume</span>
          <span className="num">${totalAmount.toFixed(0)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Wallets</span>
          <span className="num">{walletCount}</span>
        </div>
        <div className="stat up">
          <span className="stat-label">Up</span>
          <span className="num">${totalUp.toFixed(0)}</span>
        </div>
        <div className="stat down">
          <span className="stat-label">Down</span>
          <span className="num">${totalDown.toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
}
