import { Zero, MaxUint256 } from "@ethersproject/constants";
import { BigNumber } from "@ethersproject/bignumber";
import { parseUnits } from "@ethersproject/units";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { Chain, AssetType, ClobClient } from "@polymarket/clob-client";
import { getContractConfig } from "@polymarket/clob-client";
import { env, getRpcUrl } from "../config/env";

// Minimal USDC ERC20 ABI
const USDC_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
];

// Minimal ERC1155 ABI for ConditionalTokens
const CTF_ABI = [
    "function setApprovalForAll(address operator, bool approved) external",
    "function isApprovedForAll(address account, address operator) external view returns (bool)",
];


/**
 * Approve USDC to Polymarket contracts (maximum allowance)
 * Approves USDC for both ConditionalTokens and Exchange contracts
 */
export async function approveUSDCAllowance(): Promise<void> {
    const privateKey = env.PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("PRIVATE_KEY not found in environment");
    }

    const chainId = env.CHAIN_ID as Chain;
    const contractConfig = getContractConfig(chainId);
    
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);
    
    const address = await wallet.getAddress();
    console.log(`Approving USDC allowances for address: ${address}, chainId: ${chainId}`);
    console.log(`USDC Contract: ${contractConfig.collateral}`);
    console.log(`ConditionalTokens Contract: ${contractConfig.conditionalTokens}`);
    console.log(`Exchange Contract: ${contractConfig.exchange}`);

    // Create USDC contract instance
    const usdcContract = new Contract(contractConfig.collateral, USDC_ABI, wallet);

    // Configure gas options
    let gasOptions: { gasPrice?: BigNumber; gasLimit?: number } = {};
    try {
        const gasPrice = await provider.getGasPrice();
        gasOptions = {
            gasPrice: gasPrice.mul(120).div(100), // 20% buffer
            gasLimit: 200_000,
        };
    } catch (error) {
        console.log("Could not fetch gas price, using fallback");
        gasOptions = {
            gasPrice: parseUnits("100", "gwei"),
            gasLimit: 200_000,
        };
    }

    // Check and approve USDC for ConditionalTokens contract
    const ctfAllowance = await usdcContract.allowance(address, contractConfig.conditionalTokens);
    if (!ctfAllowance.eq(MaxUint256)) {
        console.log(`Current CTF allowance: ${ctfAllowance.toString()}, setting to MaxUint256...`);
        const tx = await usdcContract.approve(contractConfig.conditionalTokens, MaxUint256, gasOptions);
        console.log(`Transaction hash: ${tx.hash}`);
        await tx.wait();
        console.log("✅ USDC approved for ConditionalTokens contract");
    } else {
        console.log("✅ USDC already approved for ConditionalTokens contract (MaxUint256)");
    }

    // Check and approve USDC for Exchange contract
    const exchangeAllowance = await usdcContract.allowance(address, contractConfig.exchange);
    if (!exchangeAllowance.eq(MaxUint256)) {
        console.log(`Current Exchange allowance: ${exchangeAllowance.toString()}, setting to MaxUint256...`);
        const tx = await usdcContract.approve(contractConfig.exchange, MaxUint256, gasOptions);
        console.log(`Transaction hash: ${tx.hash}`);
        await tx.wait();
        console.log("✅ USDC approved for Exchange contract");
    } else {
        console.log("✅ USDC already approved for Exchange contract (MaxUint256)");
    }

    // Check and approve ConditionalTokens (ERC1155) for Exchange contract
    const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, wallet);
    const isApproved = await ctfContract.isApprovedForAll(address, contractConfig.exchange);
    
    if (!isApproved) {
        console.log("Approving ConditionalTokens for Exchange contract...");
        const tx = await ctfContract.setApprovalForAll(contractConfig.exchange, true, gasOptions);
        console.log(`Transaction hash: ${tx.hash}`);
        await tx.wait();
        console.log("✅ ConditionalTokens approved for Exchange contract");
    } else {
        console.log("✅ ConditionalTokens already approved for Exchange contract");
    }

    const negRisk = env.NEG_RISK;
    if (negRisk) {
        // Approve USDC for NegRiskAdapter
        const negRiskAdapterAllowance = await usdcContract.allowance(address, contractConfig.negRiskAdapter);
        if (!negRiskAdapterAllowance.eq(MaxUint256)) {
            console.log(`Current NegRiskAdapter allowance: ${negRiskAdapterAllowance.toString()}, setting to MaxUint256...`);
            const tx = await usdcContract.approve(contractConfig.negRiskAdapter, MaxUint256, gasOptions);
            console.log(`Transaction hash: ${tx.hash}`);
            await tx.wait();
            console.log("✅ USDC approved for NegRiskAdapter");
        }

        // Approve USDC for NegRiskExchange
        const negRiskExchangeAllowance = await usdcContract.allowance(address, contractConfig.negRiskExchange);
        if (!negRiskExchangeAllowance.eq(MaxUint256)) {
            console.log(`Current NegRiskExchange allowance: ${negRiskExchangeAllowance.toString()}, setting to MaxUint256...`);
            const tx = await usdcContract.approve(contractConfig.negRiskExchange, MaxUint256, gasOptions);
            console.log(`Transaction hash: ${tx.hash}`);
            await tx.wait();
            console.log("✅ USDC approved for NegRiskExchange");
        }

        // Approve ConditionalTokens for NegRiskExchange
        const isNegRiskApproved = await ctfContract.isApprovedForAll(address, contractConfig.negRiskExchange);
        if (!isNegRiskApproved) {
            console.log("Approving ConditionalTokens for NegRiskExchange...");
            const tx = await ctfContract.setApprovalForAll(contractConfig.negRiskExchange, true, gasOptions);
            console.log(`Transaction hash: ${tx.hash}`);
            await tx.wait();
            console.log("✅ ConditionalTokens approved for NegRiskExchange");
        }

        // Approve ConditionalTokens for NegRiskAdapter
        const isNegRiskAdapterApproved = await ctfContract.isApprovedForAll(address, contractConfig.negRiskAdapter);
        if (!isNegRiskAdapterApproved) {
            console.log("Approving ConditionalTokens for NegRiskAdapter...");
            const tx = await ctfContract.setApprovalForAll(contractConfig.negRiskAdapter, true, gasOptions);
            console.log(`Transaction hash: ${tx.hash}`);
            await tx.wait();
            console.log("✅ ConditionalTokens approved for NegRiskAdapter");
        }
    }

    console.log("All allowances approved successfully!");
}

/**
 * Update balance allowance in CLOB API after setting on-chain allowances
 * This syncs the on-chain allowance state with the CLOB API
 */
export async function updateClobBalanceAllowance(client: ClobClient): Promise<void> {
    try {
        console.log("Updating CLOB API balance allowance for USDC...");
        await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
        console.log("✅ CLOB API balance allowance updated for USDC");
    } catch (error) {
        console.log(`Failed to update CLOB balance allowance: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

/**
 * Approve ConditionalTokens for Exchange after buying tokens
 * This ensures tokens are approved immediately after purchase so they can be sold without delay
 * Note: ERC1155 uses setApprovalForAll which approves all tokens at once (including newly bought ones)
 */
export async function approveTokensAfterBuy(): Promise<void> {
    const privateKey = env.PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("PRIVATE_KEY not found in environment");
    }

    const chainId = env.CHAIN_ID as Chain;
    const contractConfig = getContractConfig(chainId);
    
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);
    
    const address = await wallet.getAddress();
    const ctfContract = new Contract(contractConfig.conditionalTokens, CTF_ABI, wallet);

    // Configure gas options
    let gasOptions: { gasPrice?: BigNumber; gasLimit?: number } = {};
    try {
        const gasPrice = await provider.getGasPrice();
        gasOptions = {
            gasPrice: gasPrice.mul(120).div(100), // 20% buffer
            gasLimit: 200_000,
        };
    } catch (error) {
        gasOptions = {
            gasPrice: parseUnits("100", "gwei"),
            gasLimit: 200_000,
        };
    }

    // Check if ConditionalTokens are approved for Exchange
    const isApproved = await ctfContract.isApprovedForAll(address, contractConfig.exchange);
    
    if (!isApproved) {
        console.log("Approving ConditionalTokens for Exchange (after buy)...");
        const tx = await ctfContract.setApprovalForAll(contractConfig.exchange, true, gasOptions);
        console.log(`Transaction hash: ${tx.hash}`);
        await tx.wait();
        console.log("✅ ConditionalTokens approved for Exchange");
    }

    if (env.NEG_RISK) {
        const isNegRiskApproved = await ctfContract.isApprovedForAll(address, contractConfig.negRiskExchange);
        if (!isNegRiskApproved) {
            console.log("Approving ConditionalTokens for NegRiskExchange (after buy)...");
            const tx = await ctfContract.setApprovalForAll(contractConfig.negRiskExchange, true, gasOptions);
            console.log(`Transaction hash: ${tx.hash}`);
            await tx.wait();
            console.log("✅ ConditionalTokens approved for NegRiskExchange");
        }
    }
}

