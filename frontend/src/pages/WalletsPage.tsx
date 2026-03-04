import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { WalletStatsResponse, WalletStat } from "@/lib/types";

function formatTime(ts: number | null): string {
  if (ts == null) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

/** Sort by trading count (desc), then win rate (desc). */
function topTradersOrder(wallets: WalletStat[]): WalletStat[] {
  return [...wallets].sort((a, b) => {
    const tradesA = a.winCount + a.loseCount;
    const tradesB = b.winCount + b.loseCount;
    if (tradesB !== tradesA) return tradesB - tradesA;
    return b.winRate - a.winRate;
  });
}

export function WalletsPage() {
  const [data, setData] = useState<WalletStatsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .walletStats()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "API error"));
  }, []);

  const sortedWallets = useMemo(
    () => topTradersOrder(data?.wallets ?? []),
    [data?.wallets]
  );

  if (err) {
    return (
      <div>
        <h1 className="page-title">Top traders</h1>
        <p className="err">{err}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Top traders</h1>
      <p className="page-desc">
        Wallets ranked by trading count and win rate (resolved 5m markets).
      </p>
      <div className="card">
        <h2>Top traders ({data?.count ?? 0})</h2>
        {sortedWallets.length === 0 ? (
          <p className="muted">No wallet stats yet</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Wallet</th>
                  <th className="num">Trades</th>
                  <th className="num">Wins</th>
                  <th className="num">Losses</th>
                  <th className="num">Win rate</th>
                  <th>Last trade</th>
                </tr>
              </thead>
              <tbody>
                {sortedWallets.map((w, i) => (
                  <tr key={w.wallet}>
                    <td className="num">{i + 1}</td>
                    <td className="mono">{truncate(w.wallet)}</td>
                    <td className="num">{w.winCount + w.loseCount}</td>
                    <td className="num">{w.winCount}</td>
                    <td className="num">{w.loseCount}</td>
                    <td className="num">{w.winRate.toFixed(2)}%</td>
                    <td className="mono">{formatTime(w.lastTradingTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
