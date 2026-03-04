/**
 * Optional standalone API server (MongoDB results, status, Redis state).
 * Uses Polymarket client for current BTC 5m market and trading state (Gamma API).
 */

import "dotenv/config";
import { MongoDBClient } from "../clients/mongodb";
import { RedisClient } from "../clients/redis";
import { PolymarketClient } from "../clients/polymarket";
import { getBtcPriceUsd } from "../clients/btc-price";
const ts = () => new Date().toISOString();
import http from "http";
import url from "url";

const CLOB_MIDPOINTS_URL = "https://clob.polymarket.com/midpoints";
const PORT = parseInt(process.env.API_PORT || "3002", 10);

function parseMidpointValue(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

async function startServer(): Promise<void> {
  const mongodb = new MongoDBClient();
  const redis = new RedisClient();
  const polymarket = new PolymarketClient();

  await mongodb.connect();
  console.log(`${ts()} 🔗 MongoDB`);

  let redisConnected = false;
  try {
    await redis.connect();
    redisConnected = true;
    console.log(`${ts()} 🔗 Redis`);
  } catch (err) {
    console.warn(`${ts()} ⚠ Redis not available`);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const parsedUrl = url.parse(req.url || "", true);
    const path = parsedUrl.pathname;

    try {
      if (path === "/api/results") {
        const query = parsedUrl.query as Record<string, string>;
        const filter: Record<string, string> = {};
        if (query.eventSlug) filter.eventSlug = query.eventSlug;
        if (query.conditionId) filter.conditionId = query.conditionId;
        const results = await mongodb.getMarketResults(filter);
        res.writeHead(200);
        res.end(JSON.stringify(results));
        return;
      }

      if (path === "/api/status") {
        const current = await polymarket.getCurrentBtc5MarketWithTradingState();
        const currentMarket = current ? current.marketInfo : null;
        let redisMarkets: { conditionId: string; walletCount: number; totalUsd: number }[] = [];
        if (redisConnected) {
          const conditionIds = await redis.listActiveMarkets();
          for (const cid of conditionIds) {
            const wallets = await redis.getMarketWallets(cid);
            const totalUsd = wallets.reduce((s, w) => s + w.totalBuyUsd, 0);
            redisMarkets.push({ conditionId: cid, walletCount: wallets.length, totalUsd });
          }
        }
        res.writeHead(200);
        res.end(
          JSON.stringify({
            currentMarket,
            redisMarkets,
            redisConnected,
          })
        );
        return;
      }

      if (path === "/api/redis-state") {
        if (!redisConnected) {
          res.writeHead(200);
          res.end(JSON.stringify({ markets: [], redisConnected: false }));
          return;
        }
        const conditionIds = await redis.listActiveMarkets();
        const markets: { conditionId: string; wallets: Array<{ wallet: string; totalBuyUsd: number; buyUpUsd: number; buyDownUsd: number; buyUpCount: number; buyDownCount: number }> }[] = [];
        for (const cid of conditionIds) {
          const wallets = await redis.getMarketWallets(cid);
          markets.push({
            conditionId: cid,
            wallets: wallets.map((w) => ({
              wallet: w.wallet,
              totalBuyUsd: w.totalBuyUsd,
              buyUpUsd: w.buyUpUsd,
              buyDownUsd: w.buyDownUsd,
              buyUpCount: w.buyUpCount,
              buyDownCount: w.buyDownCount,
            })),
          });
        }
        res.writeHead(200);
        res.end(JSON.stringify({ markets, redisConnected: true }));
        return;
      }

      if (path === "/api/current-market-state") {
        const current = await polymarket.getCurrentBtc5MarketWithTradingState();
        if (!current) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              currentMarket: null,
              tradingState: null,
              btcOpenPrice: null,
              upMidPrice: null,
              downMidPrice: null,
              message: "No current 5m market",
            })
          );
          return;
        }
        const { marketInfo, tradingState } = current;
        let btcOpenPrice: number | null = null;
        if (redisConnected) {
          btcOpenPrice = await redis.getBtcOpen(marketInfo.conditionId);
        }
        const now = Math.floor(Date.now() / 1000);
        const secondsLeft = Math.max(0, marketInfo.endTime - now);
        let currentBtcPrice: number | null = null;
        try {
          currentBtcPrice = await getBtcPriceUsd();
        } catch (_) {}
        let upMidPrice: number | null = tradingState.outcomePrices?.[0] ?? null;
        let downMidPrice: number | null = tradingState.outcomePrices?.[1] ?? null;
        if ((upMidPrice == null || downMidPrice == null) && tradingState.upTokenId && tradingState.downTokenId) {
          try {
            const tokenIdsQuery = [tradingState.upTokenId, tradingState.downTokenId].join(",");
            const midRes = await fetch(
              `${CLOB_MIDPOINTS_URL}?token_ids=${encodeURIComponent(tokenIdsQuery)}`
            );
            if (midRes.ok) {
              const midData = (await midRes.json()) as Record<string, unknown>;
              if (midData && !midData.error) {
                upMidPrice = parseMidpointValue(midData[tradingState.upTokenId]) ?? upMidPrice;
                downMidPrice = parseMidpointValue(midData[tradingState.downTokenId]) ?? downMidPrice;
              }
            }
          } catch (_) {}
        }
        res.writeHead(200);
        res.end(
          JSON.stringify({
            currentMarket: {
              conditionId: marketInfo.conditionId,
              eventSlug: marketInfo.eventSlug,
              startTime: marketInfo.startTime,
              endTime: marketInfo.endTime,
              isActive: marketInfo.isActive,
              secondsLeft,
              upTokenId: tradingState.upTokenId,
              downTokenId: tradingState.downTokenId,
            },
            tradingState: {
              bestBid: tradingState.bestBid,
              bestAsk: tradingState.bestAsk,
              lastTradePrice: tradingState.lastTradePrice,
              volume: tradingState.volume,
              volume24hr: tradingState.volume24hr,
              outcomePrices: tradingState.outcomePrices,
              spread: tradingState.spread,
              active: tradingState.active,
              closed: tradingState.closed,
            },
            btcOpenPrice,
            currentBtcPrice,
            upMidPrice,
            downMidPrice,
          })
        );
        return;
      }

      if (path === "/api/current-market") {
        const current = await polymarket.getCurrentBtc5MarketWithTradingState();
        const marketInfo = current?.marketInfo ?? null;
        if (!marketInfo) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              currentMarket: null,
              totalAmount: 0,
              totalWalletCount: 0,
              totalUp: 0,
              totalDown: 0,
              wallets: [],
            })
          );
          return;
        }
        const wallets = redisConnected ? await redis.getMarketWallets(marketInfo.conditionId) : [];
        const totalAmount = wallets.reduce((s, w) => s + w.totalBuyUsd, 0);
        const totalUp = wallets.reduce((s, w) => s + w.buyUpUsd, 0);
        const totalDown = wallets.reduce((s, w) => s + w.buyDownUsd, 0);
        res.writeHead(200);
        res.end(
          JSON.stringify({
            currentMarket: {
              conditionId: marketInfo.conditionId,
              eventSlug: marketInfo.eventSlug,
              startTime: marketInfo.startTime,
              endTime: marketInfo.endTime,
              isActive: marketInfo.isActive,
            },
            totalAmount,
            totalWalletCount: wallets.length,
            totalUp,
            totalDown,
            wallets: wallets.map((w) => ({
              wallet: w.wallet,
              up: w.buyUpUsd,
              down: w.buyDownUsd,
              buyTime: w.lastBuyTime ?? null,
            })),
          })
        );
        return;
      }

      if (path === "/api/wallet-stats") {
        const stats = await mongodb.getAllWalletStats();
        const wallets = stats.map((s) => {
          const total = s.winCount + s.loseCount;
          const winRate = total > 0 ? (s.winCount / total) * 100 : 0;
          return {
            wallet: s.wallet,
            winCount: s.winCount,
            loseCount: s.loseCount,
            winRate: Math.round(winRate * 100) / 100,
            lastTradingTime: s.lastTradingTime,
          };
        });
        res.writeHead(200);
        res.end(JSON.stringify({ count: wallets.length, wallets }));
        return;
      }

      if (path === "/api/predictions") {
        const query = parsedUrl.query as Record<string, string>;
        const includeResolved = query.includeResolved === "true";
        const limit = Math.min(Math.max(1, parseInt(query.limit || "50", 10) || 50), 500);
        const fetchLimit = includeResolved ? limit : Math.min(limit * 3, 500);
        const predictions = await mongodb.getPredictions(undefined, fetchLimit);
        const list = includeResolved ? predictions : predictions.filter((p) => p.actualOutcome == null);
        const limited = list.slice(0, limit);
        res.writeHead(200);
        res.end(JSON.stringify(limited));
        return;
      }

      if (path === "/api/prediction-accuracy") {
        const predictions = await mongodb.getPredictions();
        const resolved = predictions.filter((p) => p.isCorrect !== null);
        const total = resolved.length;
        const correct = resolved.filter((p) => p.isCorrect).length;
        const recent50 = resolved.slice(0, 50);
        const recentCorrect = recent50.filter((p) => p.isCorrect).length;
        res.writeHead(200);
        res.end(
          JSON.stringify({
            overall: {
              total,
              correct,
              incorrect: total - correct,
              accuracy: total > 0 ? Math.round((correct / total) * 10000) / 100 : 0,
            },
            recent50: {
              total: recent50.length,
              correct: recentCorrect,
              incorrect: recent50.length - recentCorrect,
              accuracy:
                recent50.length > 0
                  ? Math.round((recentCorrect / recent50.length) * 10000) / 100
                  : 0,
            },
          })
        );
        return;
      }

      if (path === "/api/ml/current") {
        const current = await polymarket.getCurrentBtc5MarketWithTradingState();
        const marketInfo = current?.marketInfo ?? null;
        if (!marketInfo) {
          res.writeHead(200);
          res.end(JSON.stringify({ hasPrediction: false, message: "No current market" }));
          return;
        }
        const predictions = await mongodb.getPredictions({ conditionId: marketInfo.conditionId });
        const prediction = predictions[0] ?? null;
        if (!prediction) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              hasPrediction: false,
              currentMarket: {
                conditionId: marketInfo.conditionId,
                eventSlug: marketInfo.eventSlug,
                startTime: marketInfo.startTime,
                endTime: marketInfo.endTime,
              },
              message: "No prediction yet for this market",
            })
          );
          return;
        }
        const probUp =
          prediction.predictedOutcome === "Up"
            ? prediction.confidence
            : 1 - prediction.confidence;
        const probDown = 1 - probUp;
        res.writeHead(200);
        res.end(
          JSON.stringify({
            hasPrediction: true,
            currentMarket: {
              conditionId: marketInfo.conditionId,
              eventSlug: marketInfo.eventSlug,
              startTime: marketInfo.startTime,
              endTime: marketInfo.endTime,
            },
            prediction: {
              predictedOutcome: prediction.predictedOutcome,
              confidence: prediction.confidence,
              probUp: Math.round(probUp * 10000) / 100,
              probDown: Math.round(probDown * 10000) / 100,
              predictedAt: prediction.predictedAt,
              actualOutcome: prediction.actualOutcome,
              isCorrect: prediction.isCorrect,
              wouldBuy: prediction.wouldBuy,
              traded: prediction.traded,
            },
          })
        );
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  server.listen(PORT, () => {
    console.log(`${ts()} 🌐 Listening http://localhost:${PORT}`);
  });

  process.on("SIGINT", async () => {
    await mongodb.disconnect();
    if (redisConnected) await redis.disconnect();
    process.exit(0);
  });
}

startServer().catch((err) => {
  console.error(`${ts()} ✗ API server`);
  if (err !== undefined) console.error(err);
  process.exit(1);
});
