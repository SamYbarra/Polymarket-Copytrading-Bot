"use client";

const THRESHOLD = 0.85;

export function ExtremeVolAlert({ regimeScore }: { regimeScore?: number }) {
  const extreme = regimeScore != null && regimeScore > THRESHOLD;
  if (!extreme) return null;

  return (
    <div
      className="mb-6 animate-pulse rounded-lg border-2 border-red-500/80 bg-red-500/20 px-4 py-3 text-center font-semibold text-red-300"
      role="alert"
    >
      ⚠ EXTREME VOLATILITY — Risk Reduction Activated
    </div>
  );
}
