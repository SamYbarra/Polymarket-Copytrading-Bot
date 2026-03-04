import { Dashboard } from "@/components/Dashboard";

export function DashboardPage() {
  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-desc">
        Live 5m market, BTC prices, ML prediction, and top wallets.
      </p>
      <Dashboard />
    </>
  );
}
