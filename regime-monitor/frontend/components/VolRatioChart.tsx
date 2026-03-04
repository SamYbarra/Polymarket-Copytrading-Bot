"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { RegimeHistoryPoint } from "@/hooks/useRegimeLive";

function quantile(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return s[lo]!;
  return s[lo]! * (1 - (i - lo)) + s[hi]! * (i - lo);
}

export function VolRatioChart({ data }: { data: RegimeHistoryPoint[] }) {
  const ratios = data.map((d) => d.vol_ratio).filter(Number.isFinite);
  const q25 = quantile(ratios, 0.25);
  const q75 = quantile(ratios, 0.75);
  const q90 = quantile(ratios, 0.9);

  const chartData = data.map((d) => ({
    time: new Date(d.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    vol_ratio: d.vol_ratio,
    full: d.timestamp,
  }));

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <h2 className="mb-4 text-sm font-semibold text-slate-300">Vol Ratio (time series)</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#94a3b8" />
            <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "#1e293b", border: "1px solid #475569" }}
              labelFormatter={(_, payload) => payload[0]?.payload?.full ?? ""}
            />
            <ReferenceLine y={q25} stroke="#22c55e" strokeDasharray="2 2" />
            <ReferenceLine y={q75} stroke="#eab308" strokeDasharray="2 2" />
            <ReferenceLine y={q90} stroke="#f97316" strokeDasharray="2 2" />
            <Line
              type="monotone"
              dataKey="vol_ratio"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={false}
              name="Vol Ratio"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
        <span className="text-emerald-500">Q25: {q25.toFixed(3)}</span>
        <span className="text-amber-500">Q75: {q75.toFixed(3)}</span>
        <span className="text-orange-500">Q90: {q90.toFixed(3)}</span>
      </div>
    </div>
  );
}
