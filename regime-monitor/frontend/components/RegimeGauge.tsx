"use client";

function getColor(value: number): string {
  if (value < 0.3) return "#22c55e";
  if (value < 0.6) return "#eab308";
  if (value < 0.8) return "#f97316";
  return "#ef4444";
}

const SIZE = 200;
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const CX = SIZE / 2;
const CY = SIZE / 2;

export function RegimeGauge({
  value,
  classification,
}: {
  value: number;
  classification: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const color = getColor(clamped);
  const circumference = 2 * Math.PI * R;
  const offset = circumference * (1 - clamped);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={SIZE} height={SIZE} className="rotate-[-90deg]">
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="var(--card)"
          strokeWidth={STROKE}
        />
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.2s ease" }}
        />
      </svg>
      <div className="text-center">
        <div className="text-3xl font-bold tabular-nums" style={{ color }}>
          {value.toFixed(2)}
        </div>
        <div className="text-sm text-slate-400">Regime Score</div>
        <div
          className="mt-1 text-sm font-medium"
          style={{
            color: getColor(
              classification === "EXTREME" ? 0.9 : classification === "HIGH" ? 0.7 : classification === "NORMAL" ? 0.45 : 0.2
            ),
          }}
        >
          {classification} VOL
        </div>
      </div>
    </div>
  );
}
