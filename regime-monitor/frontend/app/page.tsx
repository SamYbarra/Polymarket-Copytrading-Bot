"use client";

import { RegimeGauge } from "@/components/RegimeGauge";
import { VolRatioChart } from "@/components/VolRatioChart";
import { RegimeScoreChart } from "@/components/RegimeScoreChart";
import { MultiplierPanel } from "@/components/MultiplierPanel";
import { HistoryTable } from "@/components/HistoryTable";
import { ExtremeVolAlert } from "@/components/ExtremeVolAlert";
import { useRegimeLive } from "@/hooks/useRegimeLive";

export default function DashboardPage() {
  const { current, history, connected } = useRegimeLive();

  return (
    <main className="min-h-screen p-4 md:p-6 lg:p-8">
      <header className="mb-6 flex items-center justify-between border-b border-slate-700 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">
          Regime Monitor — Risk Governor
        </h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            connected ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
          }`}
        >
          {connected ? "LIVE" : "Connecting…"}
        </span>
      </header>

      <ExtremeVolAlert regimeScore={current?.regime_score} />

      <section className="mb-8 flex justify-center">
        <RegimeGauge value={current?.regime_score ?? 0} classification={current?.classification ?? "NORMAL"} />
      </section>

      <section className="mb-8 grid gap-6 md:grid-cols-2">
        <VolRatioChart data={history} />
        <RegimeScoreChart data={history} />
      </section>

      <section className="mb-8">
        <MultiplierPanel current={current} />
      </section>

      <section>
        <HistoryTable data={history} />
      </section>
    </main>
  );
}
