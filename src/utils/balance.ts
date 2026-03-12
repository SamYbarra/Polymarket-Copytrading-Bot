import { ClobClient, AssetType, type OpenOrder } from "@polymarket/clob-client";

const CLOB_DECIMALS = 6;

/**
 * CLOB API commonly returns amounts in raw units (micro, 6 decimals).
 * If the string already contains a decimal point, treat it as human-readable.
 */
function parseClobAmount(value: string | undefined, decimals: number = CLOB_DECIMALS): number {
    if (!value) return 0;
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const n = parseFloat(trimmed);
    if (Number.isNaN(n)) return 0;
    if (trimmed.includes(".")) return n;
    return n / Math.pow(10, decimals);
}

/**
 * Calculate available balance for placing orders
 * Formula: availableBalance = totalBalance - sum of (orderSize - orderFillAmount) for open orders
 */
export async function getAvailableBalance(
    client: ClobClient,
    assetType: AssetType,
    tokenId?: string
): Promise<number> {
    try {
        // Get total balance
        const balanceResponse = await client.getBalanceAllowance({
            asset_type: assetType,
            ...(tokenId && { token_id: tokenId }),
        });

        const totalBalance = parseClobAmount(balanceResponse.balance);

        // Get open orders for this asset
        const openOrders = await client.getOpenOrders(
            tokenId ? { asset_id: tokenId } : undefined
        );

        // Calculate reserved amount from open orders
        let reservedAmount = 0;
        for (const order of openOrders) {
            // Only count orders for the same asset type
            const orderSide = order.side.toUpperCase();
            const isBuyOrder = orderSide === "BUY";
            const isSellOrder = orderSide === "SELL";

            // For BUY orders, reserve USDC (COLLATERAL)
            // For SELL orders, reserve tokens (CONDITIONAL)
            if (
                (assetType === AssetType.COLLATERAL && isBuyOrder) ||
                (assetType === AssetType.CONDITIONAL && isSellOrder)
            ) {
                const orderSize = parseClobAmount(order.original_size);
                const sizeMatched = parseClobAmount(order.size_matched);
                const reserved = orderSize - sizeMatched;
                reservedAmount += reserved;
            }
        }

        const availableBalance = totalBalance - reservedAmount;

        console.log(
            `Balance check: Total=${totalBalance}, Reserved=${reservedAmount}, Available=${availableBalance}`
        );

        return Math.max(0, availableBalance);
    } catch (error) {
        console.log(
            `Failed to get available balance: ${error instanceof Error ? error.message : String(error)}`
        );
        // Return 0 on error to be safe
        return 0;
    }
}

/**
 * Get and display wallet balance details
 */
export async function displayWalletBalance(client: ClobClient): Promise<void> {
    try {
        const balanceResponse = await client.getBalanceAllowance({
            asset_type: AssetType.COLLATERAL,
        });

        const balance = parseClobAmount(balanceResponse.balance);
        const allowance = parseClobAmount(balanceResponse.allowance);

        console.log("═══════════════════════════════════════");
        console.log("💰 WALLET BALANCE & ALLOWANCE");
        console.log("═══════════════════════════════════════");
        console.log(`USDC Balance: ${balance.toFixed(6)}`);
        console.log(`USDC Allowance: ${allowance.toFixed(6)}`);
        console.log(`Available: ${balance.toFixed(6)} (Balance: ${balance.toFixed(6)}, Allowance: ${allowance.toFixed(6)})`);
        console.log("═══════════════════════════════════════");
    } catch (error) {
        console.log(`Failed to get wallet balance: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Validate if we have enough balance for a BUY order
 */
export async function validateBuyOrderBalance(
    client: ClobClient,
    requiredAmount: number
): Promise<{ valid: boolean; available: number; required: number; balance?: number; allowance?: number }> {
    try {
        // Get balance and allowance details
        const balanceResponse = await client.getBalanceAllowance({
            asset_type: AssetType.COLLATERAL,
        });

        const balance = parseClobAmount(balanceResponse.balance);
        const allowance = parseClobAmount(balanceResponse.allowance);
        const available = await getAvailableBalance(client, AssetType.COLLATERAL);
        const valid = available >= requiredAmount;

        if (!valid) {
            console.log("═══════════════════════════════════════");
            console.log("⚠️  INSUFFICIENT BALANCE/ALLOWANCE");
            console.log("═══════════════════════════════════════");
            console.log(`Required: ${requiredAmount.toFixed(6)} USDC`);
            console.log(`Available: ${available.toFixed(6)} USDC`);
            console.log(`Balance: ${balance.toFixed(6)} USDC`);
            console.log(`Allowance: ${allowance.toFixed(6)} USDC`);
            console.log("═══════════════════════════════════════");
        }

        return { valid, available, required: requiredAmount, balance, allowance };
    } catch (error) {
        console.log(`Failed to validate balance: ${error instanceof Error ? error.message : String(error)}`);
        const available = await getAvailableBalance(client, AssetType.COLLATERAL);
        return { valid: false, available, required: requiredAmount };
    }
}

/**
 * Validate if we have enough tokens for a SELL order
 */
export async function validateSellOrderBalance(
    client: ClobClient,
    tokenId: string,
    requiredAmount: number
): Promise<{ valid: boolean; available: number; required: number }> {
    const available = await getAvailableBalance(client, AssetType.CONDITIONAL, tokenId);
    const valid = available >= requiredAmount;

    if (!valid) {
        console.log(
            `Insufficient token balance: Token=${tokenId.substring(0, 20)}..., Required=${requiredAmount}, Available=${available}`
        );
    }

    return { valid, available, required: requiredAmount };
}


