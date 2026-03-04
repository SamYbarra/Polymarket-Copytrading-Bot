import type { MlCurrentResponse } from "@/lib/types";

interface Props {
  data: MlCurrentResponse | null;
  error?: string;
}

export function MlPredictionCard({ data, error }: Props) {
  if (error) {
    return (
      <div className="card">
        <h2>ML prediction</h2>
        <p className="err">{error}</p>
      </div>
    );
  }

  if (!data?.hasPrediction || !data.prediction) {
    return (
      <div className="card">
        <h2>ML prediction</h2>
        <p className="muted">{data?.message ?? "No prediction for current market"}</p>
      </div>
    );
  }

  const p = data.prediction;
  const outcome = p.predictedOutcome;
  const isUp = outcome === "Up";

  return (
    <div className="card">
      <h2>ML prediction</h2>
      <div className="pred-row">
        <span className="label">Prediction</span>
        <span className={isUp ? "badge badge-up" : "badge badge-down"}>{outcome}</span>
      </div>
      <div className="pred-row">
        <span className="label">Confidence</span>
        <span className="num">{(p.confidence * 100).toFixed(1)}%</span>
      </div>
      <div className="prob-bars">
        <div className="prob">
          <span className="prob-label">Up</span>
          <div className="bar-wrap">
            <div className="bar up" style={{ width: `${p.probUp}%` }} />
          </div>
          <span className="num up">{p.probUp}%</span>
        </div>
        <div className="prob">
          <span className="prob-label">Down</span>
          <div className="bar-wrap">
            <div className="bar down" style={{ width: `${p.probDown}%` }} />
          </div>
          <span className="num down">{p.probDown}%</span>
        </div>
      </div>
      {(p.wouldBuy != null || p.traded != null) && (
        <div className="flags">
          {p.wouldBuy != null && (
            <span className="badge badge-muted">
              wouldBuy: {p.wouldBuy ? "yes" : "no"}
            </span>
          )}
          {p.traded != null && (
            <span className="badge badge-muted">
              traded: {p.traded ? "yes" : "no"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
