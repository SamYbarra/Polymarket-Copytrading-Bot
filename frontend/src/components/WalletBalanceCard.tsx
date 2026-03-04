import type { WalletBalanceResponse } from "@/lib/types";

interface Props {
  balance: WalletBalanceResponse | null;
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function WalletBalanceCard({ balance }: Props) {
  if (balance == null) {
    return (
      <div className="card">
        <h2>Wallet balance</h2>
        <p className="muted">
          Backend needs PRIVATE_KEY plus API credential: either <code>credential.json</code> (e.g. at
          project <code>src/data/credential.json</code>) or env vars POLY_API_KEY, POLY_API_SECRET,
          POLY_API_PASSPHRASE. Use <code>backend/.env</code>; if you start the backend from repo root,
          it now loads that file automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Wallet balance</h2>
      <div className="prices-grid">
        <div className="price-row">
          <span className="label">Balance</span>
          <span className="num">${fmt(balance.balanceUsd)}</span>
        </div>
        <div className="price-row">
          <span className="label">Allowance</span>
          <span className="num">${fmt(balance.allowanceUsd)}</span>
        </div>
        <div className="price-row">
          <span className="label">Available</span>
          <span className="num up">${fmt(balance.availableUsd)}</span>
        </div>
      </div>
    </div>
  );
}
