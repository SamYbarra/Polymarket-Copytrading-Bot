/**
 * Set allowance before buy (rule).
 * (1) On-chain: USDC approve(exchange, max) on Polygon.
 * (2) API: update_balance_allowance for CLOB.
 * When PROXY_WALLET_ADDRESS is set, CLOB returns the proxy's balance/allowance — approve from the Safe first.
 */

import { MaxUint256 } from "@ethersproject/constants";
import { BigNumber } from "@ethersproject/bignumber";
import { parseUnits } from "@ethersproject/units";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { AssetType, ClobClient } from "@polymarket/clob-client";
import { getContractConfig } from "@polymarket/clob-client";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import { tradingEnv, getRpcUrl } from "../config/env";
const ts = () => new Date().toISOString();

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

function log(msg: string): void {
  console.log(`${ts()} ℹ ${msg}`);
}

/** Check if owner has already approved exchange to spend USDC (allowance >= MaxUint256). */
async function isUsdcApproved(
  chainId: number,
  exchangeAddress: string,
  collateralAddress: string,
  ownerAddress: string
): Promise<boolean> {
  if (!exchangeAddress || !collateralAddress || !ownerAddress) return false;
  try {
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const usdc = new Contract(collateralAddress, USDC_ABI, provider);
    const current = await usdc.allowance(ownerAddress, exchangeAddress);
    return current.gte(MaxUint256);
  } catch {
    return false;
  }
}

/**
 * When using a proxy (Safe), CLOB uses the proxy's balance/allowance. Approve USDC from the Safe.
 * Why it may not approve:
 * - PRIVATE_KEY must be a Safe owner (signer); if it's only the EOA funder, Safe won't sign.
 * - "in-flight transaction limit reached for delegated accounts": Safe has too many pending txs; clear or confirm them in Safe UI.
 * - Safe threshold > 1: need more signatures; this code only adds one.
 */
async function approveUsdcOnChainFromSafe(
  chainId: number,
  exchangeAddress: string,
  collateralAddress: string,
  privateKey: string,
  proxyAddress: string
): Promise<boolean> {
  if (!exchangeAddress || !collateralAddress) return false;
  try {
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const usdc = new Contract(collateralAddress, USDC_ABI, provider);
    const current = await usdc.allowance(proxyAddress, exchangeAddress);
    if (current.gte(MaxUint256)) {
      log("Approve: proxy (Safe) USDC allowance already MaxUint256");
      return true;
    }
    const data = usdc.interface.encodeFunctionData("approve", [exchangeAddress, MaxUint256]);
    const safeSdk = await Safe.init({
      provider: rpcUrl,
      signer: privateKey.startsWith("0x") ? privateKey : "0x" + privateKey,
      safeAddress: proxyAddress,
    });
    const safeTx = await safeSdk.createTransaction({
      transactions: [
        { to: collateralAddress, value: "0", data, operation: OperationType.Call },
      ],
    });
    const signed = await safeSdk.signTransaction(safeTx);
    log("Approve: proxy (Safe) executing USDC approve tx…");
    const result = await safeSdk.executeTransaction(signed);
    log(`Approve: proxy (Safe) USDC approve tx sent: ${result.hash}`);
    await provider.waitForTransaction(result.hash, 1, 90_000).catch(() => {});
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Approve: proxy (Safe) approve failed: ${msg}`);
    if (msg.includes("in-flight") || msg.includes("delegated")) {
      log("Approve: clear pending txs for the Safe in the Safe UI, then retry.");
    }
    return false;
  }
}

/**
 * Send on-chain ERC20 approve(exchange, max) for USDC on Polygon.
 * Returns true if tx sent or already allowed. Skips if allowance already MaxUint256.
 */
async function approveUsdcOnChain(
  chainId: number,
  exchangeAddress: string,
  collateralAddress: string,
  privateKey: string
): Promise<boolean> {
  if (!exchangeAddress || !collateralAddress) return false;
  try {
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const key = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
    const wallet = new Wallet(key, provider);

    const current = await new Contract(collateralAddress, USDC_ABI, provider).allowance(
      wallet.address,
      exchangeAddress
    );
    if (current.gte(MaxUint256)) {
      log("Approve: on-chain USDC allowance already MaxUint256");
      return true;
    }

    let gasPrice: BigNumber;
    try {
      const networkGas = await provider.getGasPrice();
      gasPrice = networkGas.mul(120).div(100);
      if (gasPrice.lt(parseUnits("30", "gwei"))) {
        gasPrice = parseUnits("30", "gwei");
      }
    } catch {
      gasPrice = parseUnits("30", "gwei");
    }

    const usdc = new Contract(collateralAddress, USDC_ABI, wallet);
    const tx = await usdc.approve(exchangeAddress, MaxUint256, {
      gasLimit: 100_000,
      gasPrice,
    });
    log(`Approve: on-chain USDC approve tx sent: ${tx.hash}`);
    await tx.wait(1);
    log("Approve: on-chain tx confirmed");
    return true;
  } catch (e: unknown) {
    const msg = String(e);
    if (msg.toLowerCase().includes("allowance") || msg.toLowerCase().includes("revert")) {
      log(`Approve: on-chain approve skipped (may already be set): ${msg}`);
      return true;
    }
    log(`Approve: on-chain USDC approve failed: ${msg}`);
    return false;
  }
}

/**
 * Set allowance before buy.
 * (1) On-chain: USDC approve(exchange, max).
 * (2) API: update_balance_allowance for COLLATERAL and CONDITIONAL.
 * Returns true on success or when API step is skipped; false if no client/key.
 */
export async function runApprove(client: ClobClient | null): Promise<boolean> {
  if (client == null) return false;

  let key = tradingEnv.PRIVATE_KEY ?? "";
  key = (key || "").trim();
  if (!key) return false;
  if (!key.startsWith("0x")) key = "0x" + key;

  const chainId = tradingEnv.CHAIN_ID ?? 137;
  const proxyAddress = (tradingEnv.PROXY_WALLET_ADDRESS ?? "").trim();

  // 1) On-chain USDC approve. When proxy is set, CLOB returns proxy balance/allowance — approve from Safe first.
  try {
    const config = getContractConfig(chainId);
    if (proxyAddress) {
      log("Approve: proxy (Safe) set — running Safe USDC approve so CLOB has allowance");
      const ok = await approveUsdcOnChainFromSafe(chainId, config.exchange, config.collateral, key, proxyAddress);
      if (!ok) log("Approve: proxy (Safe) step did not succeed (see reason above); EOA approve will still run.");
    }
    await approveUsdcOnChain(chainId, config.exchange, config.collateral, key);
  } catch (e) {
    log(`Approve: on-chain approve step failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) API update so CLOB knows (COLLATERAL only). Known issue: CLOB may still return allowance 0 for proxy (clob-client#128).
  if (typeof client.updateBalanceAllowance !== "function") return true;
  try {
    await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    log("Approve: collateral (USDC) API allowance updated");
    await new Promise((r) => setTimeout(r, 2000));
    await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  } catch (e) {
    log(`Approve: API step failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return true;
}

/**
 * Alias for runApprove: get client and run. Use when you already have client from index.
 * For startup: createCredential → getClobClient() → runApprove(client).
 */
export async function approveUSDCAllowance(): Promise<void> {
  const { getClobClient } = await import("../providers/clobclient");
  const client = await getClobClient();
  await runApprove(client);
}

/**
 * Update CLOB balance/allowance (API only). Same as runApprove step 2 with COLLATERAL.
 */
export async function updateClobBalanceAllowance(client: ClobClient): Promise<void> {
  await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  log("Approve: collateral (USDC) API allowance updated");
}
