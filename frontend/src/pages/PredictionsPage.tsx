import { useEffect, useState } from "react";
import { api, getApiBase } from "@/lib/api";
import type { PredictionAccuracyResponse } from "@/lib/types";
import { AccuracyCards } from "@/components/AccuracyCards";
import { PredictionsTable } from "@/components/PredictionsTable";

export function PredictionsPage() {
  const [accuracy, setAccuracy] = useState<PredictionAccuracyResponse | null>(null);
  const [predictions, setPredictions] = useState<
    Awaited<ReturnType<typeof api.predictions>>
  >([]);
  const [includeResolved, setIncludeResolved] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const predictionLimit = 50;
  useEffect(() => {
    setErr(null);
    Promise.all([api.predictionAccuracy(), api.predictions(includeResolved, predictionLimit)])
      .then(([acc, pred]) => {
        setAccuracy(acc);
        setPredictions(pred);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "API error"));
  }, [includeResolved]);

  return (
    <div>
      <h1 className="page-title">Predictions</h1>
      <p className="page-desc">
        ML prediction accuracy and recent prediction history.
      </p>
      {err && <p className="err">{err}</p>}
      <div style={{ marginBottom: "1.5rem" }}>
        <AccuracyCards data={accuracy} error={err ?? undefined} />
      </div>
      <div className="card" style={{ marginBottom: "0.75rem" }}>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(e) => setIncludeResolved(e.target.checked)}
          />
          Include resolved
        </label>
      </div>
      <PredictionsTable
        predictions={predictions}
        maxRows={predictionLimit}
        endpoint={`GET ${getApiBase()}/api/predictions?includeResolved=${includeResolved}&limit=${predictionLimit}`}
      />
    </div>
  );
}
