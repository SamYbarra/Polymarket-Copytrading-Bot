"use client";

import { useMemo, useState } from "react";
import type { RegimeHistoryPoint } from "@/hooks/useRegimeLive";

function classificationColor(c: string): string {
  switch (c) {
    case "LOW":
      return "text-emerald-400";
    case "NORMAL":
      return "text-amber-400";
    case "HIGH":
      return "text-orange-400";
    case "EXTREME":
      return "text-red-400";
    default:
      return "text-slate-400";
  }
}

function classify(score: number): string {
  if (score < 0.3) return "LOW";
  if (score < 0.6) return "NORMAL";
  if (score < 0.8) return "HIGH";
  return "EXTREME";
}

export function HistoryTable({ data }: { data: RegimeHistoryPoint[] }) {
  const [sortKey, setSortKey] = useState<"time" | "vol_ratio" | "regime_score" | "classification">("time");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const arr = [...data];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "time") cmp = a.timestamp.localeCompare(b.timestamp);
      else if (sortKey === "vol_ratio") cmp = a.vol_ratio - b.vol_ratio;
      else if (sortKey === "regime_score") cmp = a.regime_score - b.regime_score;
      else cmp = classify(a.regime_score).localeCompare(classify(b.regime_score));
      return asc ? cmp : -cmp;
    });
    return arr.slice(-100).reverse();
  }, [data, sortKey, asc]);

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) setAsc((a) => !a);
    else {
      setSortKey(key);
      setAsc(false);
    }
  }

  function exportCsv() {
    const headers = ["Time", "VolRatio", "RegimeScore", "Classification"];
    const rows = sorted.map((d) => [
      d.timestamp,
      d.vol_ratio.toFixed(4),
      d.regime_score.toFixed(4),
      classify(d.regime_score),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `regime-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">History</h2>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded bg-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-500"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-600 text-slate-400">
              <th
                className="cursor-pointer py-2 pr-4 hover:text-slate-300"
                onClick={() => handleSort("time")}
              >
                Time {sortKey === "time" && (asc ? "↑" : "↓")}
              </th>
              <th
                className="cursor-pointer py-2 pr-4 hover:text-slate-300"
                onClick={() => handleSort("vol_ratio")}
              >
                VolRatio {sortKey === "vol_ratio" && (asc ? "↑" : "↓")}
              </th>
              <th
                className="cursor-pointer py-2 pr-4 hover:text-slate-300"
                onClick={() => handleSort("regime_score")}
              >
                RegimeScore {sortKey === "regime_score" && (asc ? "↑" : "↓")}
              </th>
              <th
                className="cursor-pointer py-2 hover:text-slate-300"
                onClick={() => handleSort("classification")}
              >
                Classification {sortKey === "classification" && (asc ? "↑" : "↓")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d, i) => (
              <tr key={`${d.timestamp}-${i}`} className="border-b border-slate-700/80">
                <td className="py-2 pr-4 font-mono text-slate-300">
                  {new Date(d.timestamp).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </td>
                <td className="py-2 pr-4 font-mono">{d.vol_ratio.toFixed(3)}</td>
                <td className="py-2 pr-4 font-mono">{d.regime_score.toFixed(3)}</td>
                <td className={`py-2 font-medium ${classificationColor(classify(d.regime_score))}`}>
                  {classify(d.regime_score)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
