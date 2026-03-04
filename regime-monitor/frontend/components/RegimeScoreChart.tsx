"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { RegimeHistoryPoint } from "@/hooks/useRegimeLive";

export function RegimeScoreChart({ data }: { data: RegimeHistoryPoint[] }) {
  const chartData = data.map((d) => ({
    time: new Date(d.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    regime_score: d.regime_score,
    full: d.timestamp,
  }));

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <h2 className="mb-4 text-sm font-semibold text-slate-300">Regime Score (time series)</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#94a3b8" />
            <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" domain={[0, 1]} />
            <Tooltip
              contentStyle={{ background: "#1e293b", border: "1px solid #475569" }}
              labelFormatter={(_, payload) => payload[0]?.payload?.full ?? ""}
              formatter={(v: number) => [v.toFixed(3), "Regime Score"]}
            />
            <Line
              type="monotone"
              dataKey="regime_score"
              stroke="#a78bfa"
              strokeWidth={2}
              dot={false}
              name="Regime Score"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
