/**
 * Manual resolver: resolve specific markets by event slug (BTC 5m).
 * Usage:
 *   npm run manual-resolve
 *   npm run manual-resolve -- btc-updown-5m-1771635600 btc-updown-5m-1771636500 ...
 *   npm run manual-resolve -- --outcome=Up btc-updown-5m-1771635600
 *   npm run manual-resolve -- --create-if-missing
 */

import "dotenv/config";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: resolve(process.cwd(), ".env") });

import { PolymarketClient } from "../clients/polymarket";
import { MongoDBClient } from "../clients/mongodb";
import { marketWindowSeconds } from "../config/market";

const ts = () => new Date().toISOString();
const shortId = (id: string, head = 10, tail = 6): string => {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
};
const shortSlug = (slug: string, maxLen = 24): string => {
  if (!slug || slug.length <= maxLen) return slug;
  const tail = 8;
  return `${slug.slice(0, maxLen - tail - 1)}…${slug.slice(-tail)}`;
};
import type { MarketResult } from "../types";

const EVENT_SLUGS: string[] = [];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let forceOutcome: "Up" | "Down" | null = null;
  let createIfMissing = false;
  const slugs: string[] = [];

  for (const a of args) {
    if (a === "--create-if-missing") {
      createIfMissing = true;
    } else if (a.startsWith("--outcome=")) {
      const v = a.split("=")[1]?.toLowerCase();
      if (v === "up" || v === "down") forceOutcome = v === "up" ? "Up" : "Down";
    } else if (a && !a.startsWith("--")) {
      slugs.push(a);
    }
  }

  const eventSlugs = slugs.length > 0 ? slugs : EVENT_SLUGS;

  console.log(`${ts()} 🏁 Manual resolve: ${eventSlugs.length} event(s)${forceOutcome ? `, force=${forceOutcome}` : ""}`);

  const polymarket = new PolymarketClient();
  const mongodb = new MongoDBClient();
  await mongodb.connect();

  for (const eventSlug of eventSlugs) {
    const event = await polymarket.getEventBySlug(eventSlug);
    if (!event?.markets?.length) {
      console.warn(`${ts()} ⚠   ${shortSlug(eventSlug)}: event not found on Gamma`);
      continue;
    }

    const market = event.markets[0];
    const conditionId = market.conditionId;
    if (!conditionId) {
      console.warn(`${ts()} ⚠   ${shortSlug(eventSlug)}: no conditionId`);
      continue;
    }

    let resolvedOutcome: "Up" | "Down" | null = forceOutcome;
    if (!resolvedOutcome) {
      resolvedOutcome = await polymarket.getResolutionOutcome(eventSlug, conditionId);
      if (!resolvedOutcome) {
        resolvedOutcome = await polymarket.getResolutionOutcomeByConditionId(conditionId);
      }
    }

    const bySlug = await mongodb.getMarketResults({ eventSlug });
    const byCid = await mongodb.getMarketResults({ conditionId });
    const doc = bySlug[0] ?? byCid[0] ?? null;

    if (!doc) {
      if (createIfMissing && resolvedOutcome) {
        const startTime = market.eventStartTime
          ? Math.floor(new Date(market.eventStartTime).getTime() / 1000)
          : market.startDate
            ? Math.floor(new Date(market.startDate).getTime() / 1000)
            : 0;
        const endTime = startTime + marketWindowSeconds();
        const minimal: MarketResult = {
          conditionId,
          eventSlug,
          startTime,
          endTime,
          resolvedOutcome: null,
          profitableWallets: [],
          timestamp: Math.floor(Date.now() / 1000),
        };
        await mongodb.saveMarketResult(minimal);
        console.log(`${ts()} ✔   ${shortSlug(eventSlug)}: created minimal market_result`);
      } else {
        console.log(`${ts()} ⏭   ${shortSlug(eventSlug)}: not in market_results (use --create-if-missing)`);
        continue;
      }
    }

    const docToUse = doc ?? (await mongodb.getMarketResults({ conditionId }))[0];
    if (!docToUse) {
      console.error(`${ts()} ✗   ${shortSlug(eventSlug)}: failed to get doc after create`);
      continue;
    }

    if (docToUse.resolvedOutcome) {
      console.log(`${ts()} ℹ   ${shortSlug(eventSlug)}: already resolved ${docToUse.resolvedOutcome}`);
      continue;
    }

    if (resolvedOutcome !== "Up" && resolvedOutcome !== "Down") {
      console.warn(`${ts()} ⚠   ${shortSlug(eventSlug)}: no resolution yet${forceOutcome ? "" : " (use --outcome=Up|Down)"}`);
      continue;
    }

    const withProfits = (docToUse.profitableWallets ?? []).map((w) => {
      const profitUsd =
        resolvedOutcome === "Up"
          ? w.buyUpUsd - w.buyDownUsd
          : w.buyDownUsd - w.buyUpUsd;
      return {
        wallet: w.wallet,
        buyUpUsd: w.buyUpUsd,
        buyDownUsd: w.buyDownUsd,
        totalBuyUsd: w.totalBuyUsd,
        profitUsd,
      };
    });

    await mongodb.updateMarketResultResolution(docToUse.conditionId, resolvedOutcome, withProfits);

    const result: MarketResult = {
      conditionId: docToUse.conditionId,
      eventSlug: docToUse.eventSlug,
      startTime: docToUse.startTime,
      endTime: docToUse.endTime,
      resolvedOutcome,
      profitableWallets: withProfits,
      timestamp: docToUse.timestamp,
    };
    await mongodb.upsertWalletStatsFromResult(result);

    const { PredictionService } = await import("../services/prediction-service");
    const predictionService = new PredictionService(mongodb);
    await predictionService.updatePredictionAccuracy(docToUse.conditionId, resolvedOutcome);

    const profitableCount = withProfits.filter((w) => w.profitUsd > 0).length;
    console.log(`${ts()} 🏁   ${shortSlug(eventSlug)} → ${resolvedOutcome}, ${withProfits.length} wallets, ${profitableCount} profitable`);
  }

  await mongodb.disconnect();
  console.log(`${ts()} ✔ Done`);
}

main().catch((err) => {
  console.error(`${ts()} ✗ Fatal`);
  if (err !== undefined) console.error(err);
  process.exit(1);
});
