interface Props {
  btcOpen: number | null;
  btcCurrent: number | null;
  upMid: number | null;
  downMid: number | null;
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(n: number | null): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function LivePrices({ btcOpen, btcCurrent, upMid, downMid }: Props) {
  const delta =
    btcOpen != null && btcCurrent != null ? btcCurrent - btcOpen : null;

  return (
    <div className="card">
      <h2>Live prices</h2>
      <div className="prices-grid">
        <div className="price-row">
          <span className="label">BTC open</span>
          <span className="num">${fmt(btcOpen)}</span>
        </div>
        <div className="price-row">
          <span className="label">BTC now</span>
          <span className="num">${fmt(btcCurrent)}</span>
        </div>
        <div className="price-row">
          <span className="label">Δ</span>
          <span className={delta != null ? (delta >= 0 ? "num up" : "num down") : "num"}>
            {delta != null ? (delta >= 0 ? "+" : "") + delta.toFixed(2) : "—"}
          </span>
        </div>
        <div className="price-row">
          <span className="label">Up mid</span>
          <span className="num up">{pct(upMid)}</span>
        </div>
        <div className="price-row">
          <span className="label">Down mid</span>
          <span className="num down">{pct(downMid)}</span>
        </div>
      </div>
    </div>
  );
}
