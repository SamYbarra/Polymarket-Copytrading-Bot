import type { Prediction } from "@/lib/types";

interface Props {
  predictions: Prediction[];
  maxRows?: number;
  /** Optional endpoint to show (e.g. "GET /api/predictions?includeResolved=true") */
  endpoint?: string;
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PredictionsTable({ predictions, maxRows = 20, endpoint }: Props) {
  const show = predictions.slice(0, maxRows);

  if (predictions.length === 0) {
    return (
      <div className="card">
        <h2>Recent prediction history</h2>
        {endpoint && <p className="muted endpoint">{endpoint}</p>}
        <p className="muted">No predictions yet</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Recent prediction history</h2>
      {endpoint && <p className="muted endpoint">{endpoint}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Outcome</th>
              <th>Resolve result</th>
              <th>Will buy</th>
              <th className="num">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {show.map((p, i) => (
              <tr key={`${p.conditionId}-${p.predictedAt}-${i}`}>
                <td className="mono">{formatTime(p.predictedAt)}</td>
                <td>
                  <span
                    className={
                      p.predictedOutcome === "Up" ? "badge badge-up" : "badge badge-down"
                    }
                  >
                    {p.predictedOutcome}
                  </span>
                </td>
                <td>
                  {p.actualOutcome == null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      <span className={p.actualOutcome === "Up" ? "badge badge-up" : "badge badge-down"}>
                        {p.actualOutcome}
                      </span>
                      {p.isCorrect !== null && (
                        p.isCorrect ? (
                          <span className="correct"> ✓</span>
                        ) : (
                          <span className="incorrect"> ✗</span>
                        )
                      )}
                    </>
                  )}
                </td>
                <td>
                  {p.wouldBuy === undefined || p.wouldBuy === null ? (
                    <span className="muted">—</span>
                  ) : p.wouldBuy ? (
                    <span className="correct">Yes</span>
                  ) : (
                    <span className="muted">No</span>
                  )}
                </td>
                <td className="num">{(p.confidence * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
