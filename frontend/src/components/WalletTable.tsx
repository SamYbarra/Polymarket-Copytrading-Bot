import type { CurrentMarketWallet } from "@/lib/types";

interface Props {
  wallets: CurrentMarketWallet[];
  maxRows?: number;
}

function truncate(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletTable({ wallets, maxRows = 10 }: Props) {
  const show = wallets.slice(0, maxRows);
  const more = wallets.length - show.length;

  if (wallets.length === 0) {
    return (
      <div className="card">
        <h2>Top wallets (this market)</h2>
        <p className="muted">No wallet activity yet</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Top wallets (this market)</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Wallet</th>
              <th className="num">Up</th>
              <th className="num">Down</th>
            </tr>
          </thead>
          <tbody>
            {show.map((w) => (
              <tr key={w.wallet}>
                <td className="mono">{truncate(w.wallet)}</td>
                <td className="num up">${w.up.toFixed(0)}</td>
                <td className="num down">${w.down.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && <p className="more muted">+{more} more</p>}
    </div>
  );
}
