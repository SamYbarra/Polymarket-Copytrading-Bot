import type { MyOrder } from "@/lib/types";

interface Props {
  orders: MyOrder[];
}

function fmtPrice(n: number): string {
  return (n * 100).toFixed(1) + "%";
}
function fmtUsd(n: number): string {
  return "$" + n.toFixed(2);
}
function fmtSize(n: number): string {
  return n.toFixed(2);
}

export function MyOrdersTable({ orders }: Props) {
  if (orders.length === 0) {
    return (
      <div className="card">
        <h2>My orders (current market)</h2>
        <p className="muted">No open orders for this market.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>My orders (current market)</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Side</th>
              <th>Outcome</th>
              <th>Price</th>
              <th>Size</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <span className={o.side === "BUY" ? "badge badge-up" : "badge badge-down"}>
                    {o.side}
                  </span>
                </td>
                <td>{o.outcome}</td>
                <td className="num">{fmtPrice(o.price)}</td>
                <td className="num">{fmtSize(o.size)}</td>
                <td className="num">{fmtUsd(o.amountUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
