import { Side, OrderType, UserMarketOrder, CreateOrderOptions } from "@polymarket/clob-client";
import type { TradePayload } from "../utils/types";
import type { CopyTradeOptions } from "./types";

/** Clamp price to CLOB range [tickSize, 1 - tickSize] to avoid "invalid price" API errors. */
export function clampPrice(price: number, tickSize: string): number {
    const t = parseFloat(tickSize);
    return Math.max(t, Math.min(1 - t, price));
}

/**
 * Convert trade side string to Side enum
 */
export function parseTradeSide(side: string): Side {
    const upperSide = side.toUpperCase();
    if (upperSide === "BUY") {
        return Side.BUY;
    } else if (upperSide === "SELL") {
        return Side.SELL;
    }
    throw new Error(`Invalid trade side: ${side}`);
}

/**
 * Calculate the amount for a market order based on trade data
 *
 * For BUY: if orderSizeTokens is set, amount = price * orderSizeTokens; else price * (size * sizeMultiplier), capped by maxAmount.
 * For SELL: amount is in shares (size * sizeMultiplier).
 */
export function calculateMarketOrderAmount(
    trade: TradePayload,
    sizeMultiplier: number = 1.0,
    maxAmount?: number,
    orderSizeTokens?: number,
    orderAmountUsdc?: number
): number {
    if (trade.side.toUpperCase() === "BUY") {
        if (orderAmountUsdc != null && orderAmountUsdc > 0) return Math.max(1, orderAmountUsdc);
        let calculatedAmount: number;
        if (orderSizeTokens != null && orderSizeTokens > 0) {
            calculatedAmount = trade.price * orderSizeTokens;
        } else {
            const adjustedSize = trade.size * sizeMultiplier;
            calculatedAmount = trade.price * adjustedSize;
            if (calculatedAmount < 1) return 1;
            if (maxAmount != null && calculatedAmount > maxAmount) {
                calculatedAmount = maxAmount * 0.5;
                return maxAmount;
            }
        }
        return Math.max(1, calculatedAmount);
    }
    const adjustedSize = trade.size * sizeMultiplier;
    return adjustedSize;
}

/**
 * Convert a trade payload to a UserMarketOrder
 */
export function tradeToMarketOrder(options: CopyTradeOptions): UserMarketOrder {
    const { trade, sizeMultiplier = 1.0, maxAmount, orderSizeTokens, orderAmountUsdc, orderType = OrderType.FAK, feeRateBps, tickSize = "0.01" } = options;
    const side = parseTradeSide(trade.side);
    const amount = calculateMarketOrderAmount(trade, sizeMultiplier, maxAmount, orderSizeTokens, orderAmountUsdc);
    const price = clampPrice(trade.price ?? 0, tickSize);
    const marketOrder: UserMarketOrder = {
        tokenID: trade.asset,
        side,
        amount,
        price,
        orderType,
        ...(feeRateBps !== undefined && { feeRateBps }),
    };
    return marketOrder;
}

/**
 * Get default order options based on trade
 */
export function getDefaultOrderOptions(
    tickSize: CreateOrderOptions["tickSize"] = "0.01",
    negRisk: boolean = false
): Partial<CreateOrderOptions> {
    return {
        tickSize,
        negRisk,
    };
}

