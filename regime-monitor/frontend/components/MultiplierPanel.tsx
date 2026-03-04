"use client";

import type { RegimeCurrent } from "@/hooks/useRegimeLive";

const items: { key: keyof RegimeCurrent; label: string; color: string }[] = [
  { key: "kelly_multiplier", label: "Kelly Multiplier", color: "text-cyan-400" },
  { key: "threshold_multiplier", label: "Threshold Multiplier", color: "text-amber-400" },
  { key: "shrink_multiplier", label: "Probability Shrink", color: "text-violet-400" },
  { key: "momentum_weight_adj", label: "Momentum Weight Adj", color: "text-emerald-400" },
];

export function MultiplierPanel({ current }: { current: RegimeCurrent | null }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <h2 className="mb-4 text-sm font-semibold text-slate-300">Multipliers</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {items.map(({ key, label, color }) => {
          const raw = current?.[key];
          const value =
            typeof raw === "number" ? raw.toFixed(2) : current ? String(raw ?? "—") : "—";
          return (
            <div key={key} className="rounded-lg bg-slate-900/80 p-3">
              <div className="text-xs text-slate-500">{label}</div>
              <div className={`text-xl font-mono font-semibold ${color}`}>{value}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
