import { studioDevnet } from "genlayer-js/chains";
import type { ContractWriteAdapter } from "../contract";
import { asAddress, connectWallet, type Address, type ChainLike, type ConnectedWallet, type WalletSessionEvent } from "./connection";
import { WalletRegistry, type DiscoveryHost, type WalletCandidate } from "./providers";

export const WALLET_SESSION_STATE_MACHINE = true;

export type WalletPhase =
  | "DISCONNECTED"
  | "DISCOVERING"
  | "CHOOSER_OPEN"
  | "CONNECTING"
  | "CONNECTED"
  | "WRONG_CHAIN"
  | "ERROR";

export interface WalletSessionState {
  phase: WalletPhase;
  wallets: readonly WalletCandidate[];
  selectedProvider: WalletCandidate | null;
  wallet: ConnectedWallet | null;
  account: Address | null;
  chainId: string | null;
  writeClient: ContractWriteAdapter | null;
  error: string;
}

export interface WalletSessionStore {
  getWalletState(): WalletSessionState;
  subscribeWalletState(listener: () => void): () => void;
  selectWalletView(): ReturnType<typeof selectWalletView>;
  openWalletPicker(): void;
  closeWalletPicker(): void;
  selectWallet(candidate: WalletCandidate): Promise<ConnectedWallet | null>;
  disconnectWallet(): void;
  destroy(): void;
}

export function emptyWalletSessionState(): WalletSessionState {
  return {
    phase: "DISCONNECTED",
    wallets: [],
    selectedProvider: null,
    wallet: null,
    account: null,
    chainId: null,
    writeClient: null,
    error: "",
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The wallet could not connect.";
}

function chainIdOf(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function createWalletStore(
  host: DiscoveryHost,
  bindWriteClient: (wallet: ConnectedWallet) => ContractWriteAdapter,
  chain: ChainLike = studioDevnet,
): WalletSessionStore {
  const registry = new WalletRegistry(host);
  const expectedChainId = `0x${chain.id.toString(16)}`.toLowerCase();
  const listeners = new Set<() => void>();
  let state: WalletSessionState = { ...emptyWalletSessionState(), wallets: registry.getWallets() };
  let activeWallet: ConnectedWallet | null = null;

  function commit(next: WalletSessionState): void {
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }

  const unsubscribeRegistry = registry.subscribe(() => {
    commit({ ...state, wallets: registry.getWallets() });
  });

  function disconnectWallet(): void {
    activeWallet?.cleanup();
    activeWallet = null;
    commit({ ...state, phase: "DISCONNECTED", selectedProvider: null, wallet: null, account: null, chainId: null, writeClient: null, error: "" });
  }

  function handleSessionEvent(event: WalletSessionEvent): void {
    if (!activeWallet) return;
    if (event.type === "disconnect") {
      disconnectWallet();
      return;
    }
    if (event.type === "accountsChanged") {
      const raw = Array.isArray(event.accounts) ? event.accounts[0] : undefined;
      if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
        disconnectWallet();
        return;
      }
      const account = asAddress(raw);
      activeWallet = { ...activeWallet, account };
    }
    if (event.type === "chainChanged") {
      activeWallet = { ...activeWallet, chainId: chainIdOf(event.chainId) };
    }

    const chainId = event.type === "chainChanged" ? chainIdOf(event.chainId) : state.chainId ?? activeWallet.chainId;
    if (chainId !== expectedChainId) {
      commit({ ...state, phase: "WRONG_CHAIN", wallet: null, account: activeWallet.account, chainId, writeClient: null, error: "Switch to the supported network." });
      return;
    }
    try {
      const writeClient = bindWriteClient(activeWallet);
      commit({ ...state, phase: "CONNECTED", wallet: activeWallet, account: activeWallet.account, chainId, writeClient, error: "" });
    } catch (cause) {
      commit({ ...state, phase: "ERROR", wallet: null, account: activeWallet.account, chainId, writeClient: null, error: messageOf(cause) });
    }
  }

  return {
    getWalletState: () => state,
    subscribeWalletState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectWalletView: () => selectWalletView(state),
    openWalletPicker() {
      if (state.phase === "CONNECTING") return;
      commit({ ...state, phase: "DISCOVERING", error: "" });
      commit({ ...state, phase: "CHOOSER_OPEN", wallets: registry.getWallets(), error: "" });
    },
    closeWalletPicker() {
      if (state.phase === "CONNECTING") return;
      if (state.phase === "CHOOSER_OPEN" || state.phase === "ERROR") {
        commit({ ...state, phase: activeWallet ? "CONNECTED" : "DISCONNECTED", error: "" });
      }
    },
    async selectWallet(candidate) {
      const discovered = state.wallets.find((item) => item.id === candidate.id && item.provider === candidate.provider);
      if (!discovered) {
        commit({ ...state, phase: "ERROR", error: "That wallet is no longer available. Choose a detected wallet." });
        return null;
      }
      activeWallet?.cleanup();
      activeWallet = null;
      commit({ ...state, phase: "CONNECTING", selectedProvider: discovered, wallet: null, account: null, chainId: null, writeClient: null, error: "" });
      try {
        const connected = await connectWallet(discovered, { chain, reload: handleSessionEvent });
        activeWallet = connected;
        const writeClient = bindWriteClient(connected);
        commit({ ...state, phase: "CONNECTED", selectedProvider: discovered, wallet: connected, account: connected.account, chainId: connected.chainId, writeClient, error: "" });
        return connected;
      } catch (cause) {
        activeWallet?.cleanup();
        activeWallet = null;
        commit({ ...state, phase: "ERROR", selectedProvider: discovered, wallet: null, account: null, chainId: null, writeClient: null, error: messageOf(cause) });
        throw cause;
      }
    },
    disconnectWallet,
    destroy() {
      activeWallet?.cleanup();
      activeWallet = null;
      unsubscribeRegistry();
      registry.destroy();
      listeners.clear();
    },
  };
}

export function selectWalletView(state: WalletSessionState) {
  const connected = state.phase === "CONNECTED" && state.wallet !== null && state.writeClient !== null;
  return {
    connected,
    chooserOpen: state.phase === "CHOOSER_OPEN" || state.phase === "CONNECTING" || state.phase === "ERROR",
    providerOptions: state.wallets,
    badge: connected && state.wallet ? `${state.wallet.name} · ${state.wallet.account.slice(0, 6)}…${state.wallet.account.slice(-4)}` : state.phase === "WRONG_CHAIN" ? "Wrong network" : "Disconnected",
    primaryAction: connected ? "Switch wallet" : state.phase === "WRONG_CHAIN" ? "Switch wallet" : "Connect wallet",
    canWrite: connected,
    error: state.error,
  } as const;
}

