import { ClobClient, OrderType, Side, AssetType } from "@polymarket/clob-client";
import type { UserMarketOrder, CreateOrderOptions } from "@polymarket/clob-client";
import type { TradePayload } from "../utils/types";
import type { CopyTradeOptions, CopyTradeResult } from "./types";
import { tradeToMarketOrder, getDefaultOrderOptions } from "./helpers";
import { addHoldings, getHoldings, removeHoldings } from "../utils/holdings";
import { approveTokensAfterBuy, updateClobBalanceAllowance } from "../security/allowance";
import { validateBuyOrderBalance, validateSellOrderBalance, displayWalletBalance } from "../utils/balance";
import { env } from "../config/env";

/**
 * Order builder for copying trades
 * Handles conversion of trade data to executable market orders
 */
export class TradeOrderBuilder {
    private client: ClobClient;

    constructor(client: ClobClient) {
        this.client = client;
    }

    /**
     * Copy a trade by placing a market order
     */
    async copyTrade(options: CopyTradeOptions): Promise<CopyTradeResult> {   
        try {
            const { trade, tickSize = "0.01", negRisk = false, orderType = OrderType.FAK } = options;
            const marketId = trade.conditionId;
            const tokenId = trade.asset;

            // For SELL orders, sell ratio * target size (capped by holdings)
            if (trade.side.toUpperCase() === "SELL") {
                const holdingsAmount = getHoldings(marketId, tokenId);
                
                if (holdingsAmount <= 0) {
                    console.log(
                        `No holdings found for token ${tokenId} in market ${marketId}. ` +
                        `Skipping SELL order.`
                    );
                    return {
                        success: false,
                        error: "No holdings available to sell",
                    };
                }

                // Convert trade to desired sell amount (shares) based on sizeMultiplier
                const desiredOrder = tradeToMarketOrder(options);
                const desiredSellAmount = Math.max(0, desiredOrder.amount || 0);

                // Cap by holdings (never sell more than we have tracked)
                const sellAmount = Math.min(holdingsAmount, desiredSellAmount);

                if (sellAmount <= 0) {
                    console.log(
                        `Calculated SELL amount is 0 (desired=${desiredSellAmount}, holdings=${holdingsAmount}). Skipping.`
                    );
                    return {
                        success: false,
                        error: "Calculated sell amount is 0",
                    };
                }
                
                // For SELL, amount is in shares
                const marketOrder: UserMarketOrder = {
                    tokenID: tokenId,
                    side: Side.SELL,
                    amount: sellAmount,
                    price: desiredOrder.price,
                    orderType,
                };

                const orderOptions: Partial<CreateOrderOptions> = getDefaultOrderOptions(tickSize, negRisk);

                console.log(`Placing SELL market order: ${sellAmount} shares (type: ${orderType})`);
                
                const response = await this.client.createAndPostMarketOrder(
                    marketOrder,
                    orderOptions,
                    orderType
                );

                // Check if order was successful
                if (!response || (response.status && response.status !== "FILLED" && response.status !== "PARTIALLY_FILLED")) {
                    console.log(`Order may not have been fully successful. Status: ${response?.status || "unknown"}`);
                }

                // For SELL orders, makingAmount is tokens sold
                // Parse the amount (might be in string format with decimals)
                const tokensSold = response.makingAmount 
                    ? parseFloat(response.makingAmount) 
                    : sellAmount;

                // Remove from holdings after successful sell
                if (tokensSold > 0) {
                    removeHoldings(marketId, tokenId, tokensSold);
                    console.log(`✅ Removed ${tokensSold} tokens from holdings: ${marketId} -> ${tokenId}`);
                } else {
                    console.log("No tokens were sold - not removing from holdings");
                }

                console.log(
                    `SELL order executed! ` +
                    `OrderID: ${response.orderID || "N/A"}, ` +
                    `Tokens sold: ${tokensSold}, ` +
                    `Status: ${response.status || "N/A"}`
                );

                return {
                    success: true,
                    orderID: response.orderID,
                    transactionHashes: response.transactionsHashes,
                    marketOrder,
                };
            }

            // For BUY orders: build order, then place (skip balance/allowance when fixed USDC for speed)
            const marketOrder = tradeToMarketOrder(options);
            const fastPath = options.orderAmountUsdc != null && options.orderAmountUsdc > 0;

            if (!fastPath) {
                try {
                    await this.client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
                } catch (error) {
                    console.log(`Balance allowance update failed: ${error instanceof Error ? error.message : String(error)}`);
                }
                await displayWalletBalance(this.client);
                const balanceCheck = await validateBuyOrderBalance(this.client, marketOrder.amount);
                if (!balanceCheck.valid) {
                    if (balanceCheck.available <= 0) {
                        return { success: false, error: `Insufficient USDC. Available: ${balanceCheck.available}` };
                    }
                    marketOrder.amount = balanceCheck.available;
                }
            }

            // Get order options
            const orderOptions: Partial<CreateOrderOptions> = getDefaultOrderOptions(tickSize, negRisk);

            // Place the market order
            console.log(`Placing ${marketOrder.side} market order: ${marketOrder.amount} (type: ${orderType})`);
            
            // Debug logging (only if DEBUG env var is set)
            if (env.DEBUG) {
                console.log(`marketOrder: ${JSON.stringify(marketOrder)}`);
                console.log(`orderOptions: ${JSON.stringify(orderOptions)}`);
                console.log(`orderType: ${orderType}`);
            }
            
            const response = await this.client.createAndPostMarketOrder(
                marketOrder,
                orderOptions,
                orderType
            );

            // Check if order was successful
            if (!response || (response.status && response.status !== "FILLED" && response.status !== "PARTIALLY_FILLED")) {
                    console.log(`Order may not have been fully successful. Status: ${response?.status || "unknown"}`);
            }

            // Get the actual filled amount from response
            // For BUY orders: makingAmount = USDC spent, takingAmount = tokens received
            const tokensReceived = response.takingAmount 
                ? parseFloat(response.takingAmount) 
                : 0;
            
            // Add to holdings after successful buy (only if we received tokens)
            if (tokensReceived > 0) {
                addHoldings(marketId, tokenId, tokensReceived);
                console.log(`✅ Added ${tokensReceived} tokens to holdings: ${marketId} -> ${tokenId}`);
            } else {
                // Fallback: estimate from order amount if response doesn't have takingAmount
                // For BUY: amount is USDC, so tokens = USDC / price
                const estimatedTokens = marketOrder.amount / (trade.price || 1);
                if (estimatedTokens > 0) {
                    addHoldings(marketId, tokenId, estimatedTokens);
                    console.log(`Using estimated token amount: ${estimatedTokens} (actual amount not in response)`);
                } else {
                    console.log("No tokens received and cannot estimate - not adding to holdings");
                }
            }

            // Approve tokens immediately after buying so they can be sold without delay
            try {
                await approveTokensAfterBuy();
            } catch (error) {
                    console.log(`Failed to approve tokens after buy: ${error instanceof Error ? error.message : String(error)}`);
            }

            console.log(
                `BUY order executed! ` +
                `OrderID: ${response.orderID || "N/A"}, ` +
                `Tokens received: ${tokensReceived || "estimated"}, ` +
                `Status: ${response.status || "N/A"}`
            );

            return {
                success: true,
                orderID: response.orderID,
                transactionHashes: response.transactionsHashes,
                marketOrder,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // If it's a balance/allowance error, show current balance
            if (errorMessage.includes("not enough balance") || errorMessage.includes("allowance")) {
                console.log("═══════════════════════════════════════");
                console.log("❌ ORDER FAILED: Balance/Allowance Error");
                console.log("═══════════════════════════════════════");
                
                // Try to display current balance
                try {
                    await displayWalletBalance(this.client);
                    // Try updating allowance and retry
                    console.log("Attempting to update balance allowance...");
                    await this.client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
                } catch (balanceError) {
                    console.log(`Failed to get balance: ${balanceError instanceof Error ? balanceError.message : String(balanceError)}`);
                }
                
                console.log("═══════════════════════════════════════");
            }
            
            console.log(`Failed to copy trade: ${errorMessage}`);
            
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Place a market buy order
     */
    async placeMarketBuy(
        tokenID: string,
        amount: number,
        options?: {
            tickSize?: CreateOrderOptions["tickSize"];
            negRisk?: boolean;
            orderType?: OrderType.FOK | OrderType.FAK;
            price?: number;
        }
    ): Promise<CopyTradeResult> {
        const marketOrder: UserMarketOrder = {
            tokenID,
            side: Side.BUY,
            amount,
            orderType: options?.orderType || OrderType.FAK,
            ...(options?.price !== undefined && { price: options.price }),
        };

        const orderOptions: Partial<CreateOrderOptions> = getDefaultOrderOptions(
            options?.tickSize,
            options?.negRisk
        );

        try {
            const response = await this.client.createAndPostMarketOrder(
                marketOrder,
                orderOptions,
                marketOrder.orderType || OrderType.FAK
            );

            return {
                success: true,
                orderID: response.orderID,
                transactionHashes: response.transactionsHashes,
                marketOrder,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Place a market sell order
     */
    async placeMarketSell(
        tokenID: string,
        amount: number,
        options?: {
            tickSize?: CreateOrderOptions["tickSize"];
            negRisk?: boolean;
            orderType?: OrderType.FOK | OrderType.FAK;
            price?: number;
        }
    ): Promise<CopyTradeResult> {
        const marketOrder: UserMarketOrder = {
            tokenID,
            side: Side.SELL,
            amount,
            orderType: options?.orderType || OrderType.FAK,
            ...(options?.price !== undefined && { price: options.price }),
        };

        const orderOptions: Partial<CreateOrderOptions> = getDefaultOrderOptions(
            options?.tickSize,
            options?.negRisk
        );

        try {
            const response = await this.client.createAndPostMarketOrder(
                marketOrder,
                orderOptions,
                marketOrder.orderType || OrderType.FAK
            );

            return {
                success: true,
                orderID: response.orderID,
                transactionHashes: response.transactionsHashes,
                marketOrder,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }
}

