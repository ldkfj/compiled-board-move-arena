// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { WalletRegistry, type DiscoveryHost, type Eip1193Provider } from "./providers";

function provider(flags: Record<string, unknown> = {}): Eip1193Provider {
  return {
    request: vi.fn(async () => []),
    ...flags,
  };
}

function hostWithAnnouncements(announcements: Array<{ info: Record<string, string>; provider: Eip1193Provider }>): DiscoveryHost {
  const host = new EventTarget() as EventTarget & { ethereum?: unknown };
  host.addEventListener("eip6963:requestProvider", () => {
    for (const announcement of announcements) {
      host.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: announcement }));
    }
  });
  return host as unknown as DiscoveryHost;
}

describe("WalletRegistry", () => {
  it.each([
    ["metamask", { uuid: "mm-only", name: "MetaMask", rdns: "io.metamask" }],
    ["okx", { uuid: "okx-only", name: "OKX Wallet", rdns: "com.okx.wallet" }],
    ["rabby", { uuid: "rabby-only", name: "Rabby", rdns: "io.rabby" }],
  ])("renders exactly one detected wallet: %s", (expected, info) => {
    const walletProvider = provider();
    const host = hostWithAnnouncements([{
      info: { ...info, icon: "data:" },
      provider: walletProvider,
    }]);

    const registry = new WalletRegistry(host);
    expect(registry.getWallets().map((wallet) => wallet.id)).toEqual([expected]);
    expect(typeof registry.getWallets()[0].provider.request).toBe("function");
    registry.destroy();
  });

  it("renders all three detected wallets in the stable picker order", () => {
    const announcements = [
      { info: { uuid: "rabby-all", name: "Rabby", icon: "data:", rdns: "io.rabby" }, provider: provider() },
      { info: { uuid: "mm-all", name: "MetaMask", icon: "data:", rdns: "io.metamask" }, provider: provider() },
      { info: { uuid: "okx-all", name: "OKX Wallet", icon: "data:", rdns: "com.okx.wallet" }, provider: provider() },
    ];
    const registry = new WalletRegistry(hostWithAnnouncements(announcements));
    expect(registry.getWallets().map((wallet) => wallet.id)).toEqual(["okx", "metamask", "rabby"]);
    expect(registry.getWallets().every((wallet) => typeof wallet.provider.request === "function")).toBe(true);
    registry.destroy();
  });

  it("discovers only canonical supported wallets without requesting accounts", () => {
    const metamask = provider({ isMetaMask: true });
    const unknown = provider({ isCoinbaseWallet: true });
    const host = hostWithAnnouncements([
      {
        info: { uuid: "mm-1", name: "MetaMask", icon: "data:", rdns: "io.metamask" },
        provider: metamask,
      },
      {
        info: { uuid: "unknown-1", name: "Unknown", icon: "data:", rdns: "com.example.wallet" },
        provider: unknown,
      },
    ]);

    const registry = new WalletRegistry(host);
    expect(registry.getWallets().map((wallet) => wallet.id)).toEqual(["metamask"]);
    expect(metamask.request).not.toHaveBeenCalled();
    registry.destroy();
  });

  it("keeps one provider per wallet and deduplicates UUID and object identity", () => {
    const rabby = provider({ isRabby: true });
    const duplicate = provider({ isRabby: true });
    const host = hostWithAnnouncements([
      {
        info: { uuid: "rabby-1", name: "Rabby", icon: "data:", rdns: "io.rabby" },
        provider: rabby,
      },
      {
        info: { uuid: "rabby-1", name: "Rabby", icon: "data:", rdns: "io.rabby" },
        provider: duplicate,
      },
      {
        info: { uuid: "rabby-2", name: "Rabby", icon: "data:", rdns: "io.rabby" },
        provider: rabby,
      },
    ]);

    const registry = new WalletRegistry(host);
    expect(registry.getWallets()).toHaveLength(1);
    expect(registry.getWallets()[0].provider).toBe(rabby);
    registry.destroy();
  });

  it("uses recognized legacy providers but never treats an arbitrary injection as a wallet", () => {
    const okx = provider({ isOKX: true });
    const unknown = provider();
    const host = new EventTarget() as EventTarget & { ethereum?: unknown };
    host.ethereum = { providers: [unknown, okx] };

    const registry = new WalletRegistry(host as unknown as DiscoveryHost);
    expect(registry.getWallets().map((wallet) => wallet.id)).toEqual(["okx"]);
    expect(unknown.request).not.toHaveBeenCalled();
    registry.destroy();
  });

  it("does not promote an aggregate injector to MetaMask when a provider collection exists", () => {
    const okx = provider({ isOKX: true });
    const aggregate = provider({ isMetaMask: true });
    const host = new EventTarget() as EventTarget & { ethereum?: unknown };
    host.ethereum = { providers: [okx], ...aggregate };

    const registry = new WalletRegistry(host as unknown as DiscoveryHost);
    expect(registry.getWallets().map((wallet) => wallet.id)).toEqual(["okx"]);
    expect(registry.getWallets()[0].provider).toBe(okx);
    registry.destroy();
  });

  it("treats an explicit OKX legacy signal as stronger than MetaMask compatibility", () => {
    const okx = provider({ isOKX: true, isMetaMask: true });
    const host = new EventTarget() as EventTarget & { ethereum?: unknown };
    host.ethereum = okx;

    const registry = new WalletRegistry(host as unknown as DiscoveryHost);
    expect(registry.getWallets().map((wallet) => wallet.id)).toEqual(["okx"]);
    registry.destroy();
  });

  it("hides conflicting EIP-6963 identity and conflicting legacy flags", () => {
    const conflictingAnnouncement = {
      info: { uuid: "conflict-eip", name: "Rabby", icon: "data:", rdns: "io.metamask" },
      provider: provider(),
    };
    const conflictingLegacy = provider({ isOKX: true, isRabby: true });
    const host = hostWithAnnouncements([conflictingAnnouncement]) as DiscoveryHost & { ethereum: unknown };
    host.ethereum = { providers: [conflictingLegacy] };

    const registry = new WalletRegistry(host);
    expect(registry.getWallets()).toEqual([]);
    registry.destroy();
  });

  it("replaces only the matching legacy wallet when its EIP-6963 provider arrives", () => {
    const legacyMetamask = provider({ isMetaMask: true });
    const legacyOkx = provider({ isOKX: true });
    const announcedMetamask = provider();
    const host = hostWithAnnouncements([
      {
        info: { uuid: "mm-replacement", name: "MetaMask", icon: "data:", rdns: "io.metamask" },
        provider: announcedMetamask,
      },
    ]) as DiscoveryHost & { ethereum: unknown };
    host.ethereum = { providers: [legacyMetamask, legacyOkx] };

    const registry = new WalletRegistry(host);
    const wallets = registry.getWallets();
    expect(wallets.map((wallet) => wallet.id)).toEqual(["okx", "metamask"]);
    expect(wallets.find((wallet) => wallet.id === "metamask")?.provider).toBe(announcedMetamask);
    expect(wallets.find((wallet) => wallet.id === "okx")?.provider).toBe(legacyOkx);
    registry.destroy();
  });
});

