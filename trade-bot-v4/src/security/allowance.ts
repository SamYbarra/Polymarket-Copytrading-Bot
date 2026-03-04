/**
 * Set allowance before buy: on-chain USDC approve + CLOB API update.
 */

import { MaxUint256 } from "@ethersproject/constants";
import { BigNumber } from "@ethersproject/bignumber";
import { parseUnits } from "@ethersproject/units";
import { Wallet } from "@ethersproject/wallet";
import { JsonRpcProvider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { AssetType, ClobClient, getContractConfig } from "@polymarket/clob-client";
import Safe from "@safe-global/protocol-kit";
import { OperationType } from "@safe-global/types-kit";
import { config, getRpcUrl } from "../config";

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

// ERC1155 (CTF) — needed so the exchange can transfer outcome tokens when we sell
const CTF_ABI = [
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address account, address operator) external view returns (bool)",
];

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

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
      transactions: [{ to: collateralAddress, value: "0", data, operation: OperationType.Call }],
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
    return false;
  }
}

async function approveConditionalTokensOnChainFromSafe(
  chainId: number,
  exchangeAddress: string,
  ctfAddress: string,
  privateKey: string,
  proxyAddress: string
): Promise<boolean> {
  if (!exchangeAddress || !ctfAddress) return false;
  try {
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const ctf = new Contract(ctfAddress, CTF_ABI, provider);
    const current = await ctf.isApprovedForAll(proxyAddress, exchangeAddress);
    if (current) {
      log("Approve: proxy (Safe) CTF setApprovalForAll(exchange) already set");
      return true;
    }
    const data = ctf.interface.encodeFunctionData("setApprovalForAll", [exchangeAddress, true]);
    const safeSdk = await Safe.init({
      provider: rpcUrl,
      signer: privateKey.startsWith("0x") ? privateKey : "0x" + privateKey,
      safeAddress: proxyAddress,
    });
    const safeTx = await safeSdk.createTransaction({
      transactions: [{ to: ctfAddress, value: "0", data, operation: OperationType.Call }],
    });
    const signed = await safeSdk.signTransaction(safeTx);
    log("Approve: proxy (Safe) executing CTF setApprovalForAll tx…");
    const result = await safeSdk.executeTransaction(signed);
    log(`Approve: proxy (Safe) CTF approve tx sent: ${result.hash}`);
    await provider.waitForTransaction(result.hash, 1, 90_000).catch(() => {});
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Approve: proxy (Safe) CTF approve failed: ${msg}`);
    return false;
  }
}

async function approveConditionalTokensOnChain(
  chainId: number,
  exchangeAddress: string,
  ctfAddress: string,
  privateKey: string
): Promise<boolean> {
  if (!exchangeAddress || !ctfAddress) return false;
  try {
    const rpcUrl = getRpcUrl(chainId);
    const provider = new JsonRpcProvider(rpcUrl);
    const key = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
    const wallet = new Wallet(key, provider);
    const ctf = new Contract(ctfAddress, CTF_ABI, provider);
    const current = await ctf.isApprovedForAll(wallet.address, exchangeAddress);
    if (current) {
      log("Approve: on-chain CTF setApprovalForAll(exchange) already set");
      return true;
    }
    let gasPrice: BigNumber;
    try {
      const networkGas = await provider.getGasPrice();
      gasPrice = networkGas.mul(120).div(100);
      if (gasPrice.lt(parseUnits("30", "gwei"))) gasPrice = parseUnits("30", "gwei");
    } catch {
      gasPrice = parseUnits("30", "gwei");
    }
    const ctfWithSigner = new Contract(ctfAddress, CTF_ABI, wallet);
    const tx = await ctfWithSigner.setApprovalForAll(exchangeAddress, true, { gasLimit: 100_000, gasPrice });
    log(`Approve: on-chain CTF setApprovalForAll tx sent: ${tx.hash}`);
    await tx.wait(1);
    return true;
  } catch (e: unknown) {
    const msg = String(e);
    log(`Approve: on-chain CTF approve failed: ${msg}`);
    return false;
  }
}

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
    const current = await new Contract(collateralAddress, USDC_ABI, provider).allowance(wallet.address, exchangeAddress);
    if (current.gte(MaxUint256)) {
      log("Approve: on-chain USDC allowance already MaxUint256");
      return true;
    }
    let gasPrice: BigNumber;
    try {
      const networkGas = await provider.getGasPrice();
      gasPrice = networkGas.mul(120).div(100);
      if (gasPrice.lt(parseUnits("30", "gwei"))) gasPrice = parseUnits("30", "gwei");
    } catch {
      gasPrice = parseUnits("30", "gwei");
    }
    const usdc = new Contract(collateralAddress, USDC_ABI, wallet);
    const tx = await usdc.approve(exchangeAddress, MaxUint256, { gasLimit: 100_000, gasPrice });
    log(`Approve: on-chain USDC approve tx sent: ${tx.hash}`);
    await tx.wait(1);
    return true;
  } catch (e: unknown) {
    const msg = String(e);
    if (msg.toLowerCase().includes("allowance") || msg.toLowerCase().includes("revert")) return true;
    log(`Approve: on-chain USDC approve failed: ${msg}`);
    return false;
  }
}

export async function runApprove(client: ClobClient | null): Promise<boolean> {
  if (client == null) return false;
  let key = (config.PRIVATE_KEY ?? "").trim();
  if (!key) return false;
  if (!key.startsWith("0x")) key = "0x" + key;
  const chainId = config.CHAIN_ID;
  const proxyAddress = (config.PROXY_WALLET ?? "").trim();
  try {
    const contractConfig = getContractConfig(chainId);
    if (proxyAddress) {
      log("Approve: proxy (Safe) set — running Safe USDC approve");
      await approveUsdcOnChainFromSafe(chainId, contractConfig.exchange, contractConfig.collateral, key, proxyAddress);
    }
    await approveUsdcOnChain(chainId, contractConfig.exchange, contractConfig.collateral, key);
    // Conditional tokens (CTF): required for sell orders so exchange can transfer outcome tokens
    if (proxyAddress) {
      log("Approve: proxy (Safe) — running Safe CTF setApprovalForAll(exchange)");
      await approveConditionalTokensOnChainFromSafe(
        chainId,
        contractConfig.exchange,
        contractConfig.conditionalTokens,
        key,
        proxyAddress
      );
    }
    await approveConditionalTokensOnChain(
      chainId,
      contractConfig.exchange,
      contractConfig.conditionalTokens,
      key
    );
  } catch (e) {
    log(`Approve: on-chain step failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    log("Approve: collateral API allowance updated");
    await new Promise((r) => setTimeout(r, 2000));
    await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    await client.updateBalanceAllowance({ asset_type: AssetType.CONDITIONAL });
    log("Approve: conditional (outcome token) API allowance updated");
  } catch (e) {
    log(`Approve: API step failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return true;
}
