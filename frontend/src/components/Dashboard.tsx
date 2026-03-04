import { useEffect, useState } from "react";
import { getDashboardStreamUrl, api } from "@/lib/api";
import type {
  CurrentMarketStateResponse,
  CurrentMarketResponse,
  MlCurrentResponse,
  WalletBalanceResponse,
  MyOrder,
} from "@/lib/types";
import { CurrentMarketCard } from "./CurrentMarketCard";
import { LivePrices } from "./LivePrices";
import { MlPredictionCard } from "./MlPredictionCard";
import { WalletTable } from "./WalletTable";
import { WalletBalanceCard } from "./WalletBalanceCard";
import { MyOrdersTable } from "./MyOrdersTable";

const ML_PREDICTION_POLL_INTERVAL_MS = 10_000;

export function Dashboard() {
  const [state, setState] = useState<CurrentMarketStateResponse | null>(null);
  const [market, setMarket] = useState<CurrentMarketResponse | null>(null);
  const [ml, setMl] = useState<MlCurrentResponse | null>(null);
  const [walletBalance, setWalletBalance] = useState<WalletBalanceResponse | null>(null);
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource(getDashboardStreamUrl());
    es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data);
        const payload = raw?.data ?? raw;
        setState(payload.state);
        setMarket(payload.market);
        setMl(payload.ml);
        setWalletBalance(payload.walletBalance ?? null);
        setMyOrders(Array.isArray(payload.myOrders) ? payload.myOrders : []);
        setErr(null);
      } catch {
        setErr("Invalid stream data");
      }
    };
    es.onerror = () => setErr("Connection lost");
    return () => es.close();
  }, []);

  useEffect(() => {
    const refreshMl = async () => {
      try {
        const mlRes = await api.mlCurrent();
        setMl(mlRes);
      } catch {
        // keep existing ml state on failure
      }
    };

    const id = setInterval(refreshMl, ML_PREDICTION_POLL_INTERVAL_MS);
    refreshMl();
    return () => clearInterval(id);
  }, []);

  if (err) {
    return (
      <div className="card">
        <p className="err">{err}</p>
        <p className="muted">Ensure the backend API is running (e.g. port 3002).</p>
      </div>
    );
  }

  const displayMarket = market?.currentMarket ?? state?.currentMarket ?? null;
  const marketConditionId = displayMarket?.conditionId ?? null;
  const volumeMatchesMarket =
    market?.currentMarket?.conditionId != null &&
    market.currentMarket.conditionId === marketConditionId;
  const safeTotalAmount = volumeMatchesMarket ? (market?.totalAmount ?? 0) : 0;
  const safeTotalUp = volumeMatchesMarket ? (market?.totalUp ?? 0) : 0;
  const safeTotalDown = volumeMatchesMarket ? (market?.totalDown ?? 0) : 0;
  const safeWalletCount = volumeMatchesMarket ? (market?.totalWalletCount ?? 0) : 0;
  const safeWallets = volumeMatchesMarket ? (market?.wallets ?? []) : [];

  return (
    <>
      <div className="grid grid-2">
        <CurrentMarketCard
          market={displayMarket}
          totalAmount={safeTotalAmount}
          totalUp={safeTotalUp}
          totalDown={safeTotalDown}
          walletCount={safeWalletCount}
        />
        <LivePrices
          btcOpen={state?.btcOpenPrice ?? null}
          btcCurrent={state?.currentBtcPrice ?? null}
          upMid={state?.upMidPrice ?? null}
          downMid={state?.downMidPrice ?? null}
        />
      </div>
      <div className="grid grid-2" style={{ marginTop: "1.25rem" }}>
        <MlPredictionCard data={ml} />
        <WalletTable wallets={safeWallets} />
      </div>
      <div className="grid grid-2" style={{ marginTop: "1.25rem" }}>
        <WalletBalanceCard balance={walletBalance} />
        <MyOrdersTable orders={myOrders} />
      </div>
    </>
  );
}
