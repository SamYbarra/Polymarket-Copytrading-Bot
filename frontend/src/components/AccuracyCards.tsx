import type { PredictionAccuracyResponse } from "@/lib/types";

interface Props {
  data: PredictionAccuracyResponse | null;
  error?: string;
}

function AccuracyBlock({
  label,
  total,
  correct,
  incorrect,
  accuracy,
}: {
  label: string;
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
}) {
  return (
    <div className="block">
      <div className="block-label">{label}</div>
      <div className="block-row">
        <span className="num">{accuracy}%</span>
        <span className="muted">
          {correct}/{total} correct
        </span>
      </div>
      <div className="block-detail muted">{incorrect} incorrect</div>
    </div>
  );
}

export function AccuracyCards({ data, error }: Props) {
  if (error) {
    return (
      <div className="card">
        <h2>Prediction accuracy</h2>
        <p className="err">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card">
        <h2>Prediction accuracy</h2>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Prediction accuracy</h2>
      <div className="accuracy-grid">
        <AccuracyBlock
          label="Overall"
          total={data.overall.total}
          correct={data.overall.correct}
          incorrect={data.overall.incorrect}
          accuracy={data.overall.accuracy}
        />
        <AccuracyBlock
          label="Recent 50"
          total={data.recent50.total}
          correct={data.recent50.correct}
          incorrect={data.recent50.incorrect}
          accuracy={data.recent50.accuracy}
        />
      </div>
    </div>
  );
}
