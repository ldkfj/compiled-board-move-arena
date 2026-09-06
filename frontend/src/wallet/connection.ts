import { studionet } from "genlayer-js/chains";
import type { WalletCandidate, Eip1193Provider } from "./providers";

export type Address = `0x${string}`;

export interface ConnectedWallet extends WalletCandidate {
  account: Address;
  chainId: string;
  cleanup: () => void;
}

export type WalletSessionEvent =
  | { type: "accountsChanged"; accounts: unknown }
  | { type: "chainChanged"; chainId: unknown }
  | { type: "disconnect" };

export interface ChainLike {
  id: number;
  name: string;
  rpcUrls: { default: { http: readonly string[] } };
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorers?: { default?: { url: string } };
}

function errorCode(error: unknown): number | string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.toLowerCase();
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message).toLowerCase();
  }
  return String(error).toLowerCase();
}

export function asAddress(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("Wallet did not return a valid account.");
  }
  return value.toLowerCase() as Address;
}

function chainParams(chain: ChainLike): Record<string, unknown> {
  return {
    chainId: `0x${chain.id.toString(16)}`,
    chainName: chain.name,
    rpcUrls: [...chain.rpcUrls.default.http],
    nativeCurrency: chain.nativeCurrency,
    ...(chain.blockExplorers?.default?.url
      ? { blockExplorerUrls: [chain.blockExplorers.default.url] }
      : {}),
  };
}

function shouldAddChain(error: unknown): boolean {
  const code = errorCode(error);
  if (code === 4902 || code === "4902") return true;
  const message = errorMessage(error);
  return message.includes("unrecognized chain") || message.includes("chain not added");
}

export async function switchToChain(provider: Eip1193Provider, chain: ChainLike = studionet): Promise<string> {
  const expected = `0x${chain.id.toString(16)}`.toLowerCase();
  const current = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (current === expected) return current;

  const switchRequest = {
    method: "wallet_switchEthereumChain",
    params: [{ chainId: expected }],
  };
  try {
    await provider.request(switchRequest);
  } catch (error) {
    if (!shouldAddChain(error)) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [chainParams(chain)] });
    await provider.request(switchRequest);
  }
  const verified = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (verified !== expected) throw new Error("The selected wallet is on the wrong network.");
  return verified;
}

function bindReload(provider: Eip1193Provider, reload: (event: WalletSessionEvent) => void): () => void {
  if (typeof provider.on !== "function") return () => undefined;
  const accountsChanged = (value: unknown) => {
    reload({ type: "accountsChanged", accounts: value });
  };
  const chainChanged = (value: unknown) => reload({ type: "chainChanged", chainId: value });
  const disconnected = () => reload({ type: "disconnect" });
  provider.on("accountsChanged", accountsChanged);
  provider.on("chainChanged", chainChanged);
  provider.on("disconnect", disconnected);
  return () => {
    provider.removeListener?.("accountsChanged", accountsChanged);
    provider.removeListener?.("chainChanged", chainChanged);
    provider.removeListener?.("disconnect", disconnected);
  };
}

export async function connectWallet(
  candidate: WalletCandidate,
  options: { reload: (event: WalletSessionEvent) => void; chain?: ChainLike },
): Promise<ConnectedWallet> {
  const accounts = await candidate.provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("No wallet account was selected.");
  }
  const requestedAccount = asAddress(accounts[0]);
  const activeAccounts = await candidate.provider.request({ method: "eth_accounts" });
  if (!Array.isArray(activeAccounts) || activeAccounts.length === 0) {
    throw new Error("The wallet did not confirm an active account.");
  }
  const account = asAddress(activeAccounts[0]);
  if (account !== requestedAccount) {
    throw new Error("The wallet account changed before connection completed.");
  }
  const chainId = await switchToChain(candidate.provider, options.chain ?? studionet);
  return { ...candidate, account, chainId, cleanup: bindReload(candidate.provider, options.reload) };
}

