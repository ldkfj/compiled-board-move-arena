// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { studionet } from "genlayer-js/chains";
import { createWalletStore, selectWalletView } from "./store";
import type { ContractWriteAdapter } from "../contract";
import type { DiscoveryHost, Eip1193Provider } from "./providers";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const SECOND_ACCOUNT = "0x2222222222222222222222222222222222222222";
const INFO = { uuid: "mm-1", name: "MetaMask", icon: "data:", rdns: "io.metamask" };

function provider(chainId = "0xf22f") {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  let currentChain = chainId;
  const value: Eip1193Provider = {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return currentChain;
      if (method === "wallet_switchEthereumChain") { currentChain = "0xf22f"; return null; }
      return null;
    }),
    on: (event, listener) => { listeners.set(event, listener); },
    removeListener: (event) => { listeners.delete(event); },
  };
  return {
    value,
    emit(event: string, payload?: unknown) { listeners.get(event)?.(payload); },
  };
}

function host() {
  const value = new EventTarget();
  value.addEventListener("eip6963:requestProvider", () => undefined);
  return value as unknown as DiscoveryHost;
}

function announce(target: DiscoveryHost, walletProvider: Eip1193Provider, uuid = INFO.uuid) {
  target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { ...INFO, uuid }, provider: walletProvider } }));
}

function makeStore(target: DiscoveryHost, bindWriteClient = vi.fn(() => ({}) as ContractWriteAdapter)) {
  return { store: createWalletStore(target, bindWriteClient), bindWriteClient };
}

describe("canonical wallet session state machine", () => {
  it("keeps a late announcement in an already open chooser without a placeholder", () => {
    const target = host();
    const { store } = makeStore(target);
    store.openWalletPicker();
    expect(store.selectWalletView().providerOptions).toHaveLength(0);
    const controls = provider();
    announce(target, controls.value);
    expect(store.selectWalletView().providerOptions.map((item) => item.name)).toEqual(["MetaMask"]);
    store.destroy();
  });

  it("keeps duplicate announcements as one option", () => {
    const target = host();
    const controls = provider();
    const { store } = makeStore(target);
    announce(target, controls.value);
    announce(target, controls.value);
    expect(store.selectWalletView().providerOptions).toHaveLength(1);
    store.destroy();
  });

  it("commits the selected provider, account and write client atomically", async () => {
    const target = host();
    const controls = provider();
    const { store, bindWriteClient } = makeStore(target);
    announce(target, controls.value);
    const candidate = store.selectWalletView().providerOptions[0];
    await store.selectWallet(candidate);
    const state = store.getWalletState();
    expect(state).toMatchObject({ phase: "CONNECTED", account: ACCOUNT, chainId: "0xf22f" });
    expect(state.selectedProvider?.provider).toBe(controls.value);
    expect(state.writeClient).toBeDefined();
    expect(bindWriteClient).toHaveBeenCalledWith(state.wallet);
    expect(selectWalletView(state)).toMatchObject({ connected: true, canWrite: true, primaryAction: "Switch wallet" });
    store.destroy();
  });

  it("enters WRONG_CHAIN, clears the write client, and recovers on the same provider", async () => {
    const target = host();
    const controls = provider();
    const { store } = makeStore(target);
    announce(target, controls.value);
    await store.selectWallet(store.selectWalletView().providerOptions[0]);
    controls.emit("chainChanged", "0x1");
    expect(store.getWalletState()).toMatchObject({ phase: "WRONG_CHAIN", account: ACCOUNT, writeClient: null });
    expect(store.selectWalletView()).toMatchObject({ connected: false, canWrite: false, primaryAction: "Switch wallet" });
    controls.emit("chainChanged", "0xf22f");
    expect(store.getWalletState()).toMatchObject({ phase: "CONNECTED", account: ACCOUNT });
    store.destroy();
  });

  it("account changes cause rebinding with no automatic resubmit", async () => {
    const target = host();
    const controls = provider();
    const { store, bindWriteClient } = makeStore(target);
    announce(target, controls.value);
    await store.selectWallet(store.selectWalletView().providerOptions[0]);
    controls.emit("accountsChanged", [SECOND_ACCOUNT]);
    expect(store.getWalletState()).toMatchObject({ phase: "CONNECTED", account: SECOND_ACCOUNT });
    expect(bindWriteClient).toHaveBeenCalledTimes(2);
    store.destroy();
  });

  it("starts a fresh reload as DISCONNECTED", () => {
    const { store } = makeStore(host());
    expect(store.getWalletState().phase).toBe("DISCONNECTED");
    store.destroy();
  });
});

