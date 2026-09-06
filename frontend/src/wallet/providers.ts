export const WALLET_ORDER = ["okx", "metamask", "rabby"] as const;
export type WalletId = (typeof WALLET_ORDER)[number];
export type WalletSource = "eip6963" | "legacy";

export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?: (eventName: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (eventName: string, listener: (...args: unknown[]) => void) => void;
  [key: string]: unknown;
}

export interface Eip6963Info {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface WalletCandidate {
  id: WalletId;
  name: "MetaMask" | "OKX Wallet" | "Rabby";
  provider: Eip1193Provider;
  source: WalletSource;
  info?: Eip6963Info;
}

export interface DiscoveryHost {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent(event: Event): boolean;
  [key: string]: unknown;
}

const ANNOUNCE_EVENT = "eip6963:announceProvider";
const REQUEST_EVENT = "eip6963:requestProvider";

const LABELS: Record<WalletId, WalletCandidate["name"]> = {
  metamask: "MetaMask",
  okx: "OKX Wallet",
  rabby: "Rabby",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asProvider(value: unknown): Eip1193Provider | null {
  if (!isObject(value) || typeof value.request !== "function") return null;
  return value as Eip1193Provider;
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function classifyName(value: unknown): WalletId | null {
  const name = normalized(value).replace(/[\s_-]+/g, "");
  if (name === "metamask" || name === "metamaskwallet") return "metamask";
  if (name === "okx" || name === "okxwallet") return "okx";
  if (name === "rabby" || name === "rabbywallet") return "rabby";
  return null;
}

function classifyRdns(value: unknown): WalletId | null {
  const rdns = normalized(value);
  if (rdns === "io.metamask" || rdns === "io.metamask.flask") return "metamask";
  if (rdns === "com.okx.wallet" || rdns === "com.okex.wallet") return "okx";
  if (rdns === "io.rabby") return "rabby";
  return null;
}

function uniqueWallet(ids: Array<WalletId | null>): WalletId | null {
  const unique = [...new Set(ids.filter((id): id is WalletId => id !== null))];
  return unique.length === 1 ? unique[0] : null;
}

function classifyFlags(provider: Eip1193Provider): WalletId[] {
  const flags = provider as Record<string, unknown>;
  const isRabby = flags.isRabby === true;
  const isOkx = flags.isOkx === true || flags.isOKX === true || flags.isOKEx === true || flags.isOkxWallet === true || flags.isOKExWallet === true;
  if (isRabby && isOkx) return [];
  if (isRabby) return ["rabby"];
  if (isOkx) return ["okx"];
  return flags.isMetaMask === true ? ["metamask"] : [];
}

function classifyAnnouncement(info: Partial<Eip6963Info> | undefined): WalletId | null {
  return uniqueWallet([classifyRdns(info?.rdns), classifyName(info?.name)]);
}

function classifyLegacy(provider: Eip1193Provider): WalletId | null {
  return uniqueWallet(classifyFlags(provider));
}

export function classifyWallet(info: Partial<Eip6963Info> | undefined, provider: Eip1193Provider): WalletId | null {
  return uniqueWallet([
    classifyRdns(info?.rdns),
    classifyName(info?.name),
    ...classifyFlags(provider),
  ]);
}

function readLegacyProviders(host: DiscoveryHost): Eip1193Provider[] {
  const injected = host["ethereum"];
  const providers = isObject(injected) && Array.isArray(injected["providers"]) ? injected["providers"] : [];
  const candidates = [
    ...providers,
    ...(providers.length === 0 && isObject(injected) ? [injected] : []),
    host["okxwallet"],
    host["rabby"],
    host["metamask"],
  ];
  const result: Eip1193Provider[] = [];
  for (const candidate of candidates) {
    const provider = asProvider(candidate);
    if (provider && !result.includes(provider)) result.push(provider);
  }
  return result;
}

function eventDetail(event: Event): { info: Eip6963Info; provider: Eip1193Provider } | null {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!isObject(detail) || !isObject(detail.info)) return null;
  const provider = asProvider(detail.provider);
  if (!provider) return null;
  const info = detail.info;
  if (
    typeof info.uuid !== "string" ||
    typeof info.name !== "string" ||
    typeof info.icon !== "string" ||
    typeof info.rdns !== "string" ||
    info.uuid.trim() === ""
  ) {
    return null;
  }
  return { info: info as unknown as Eip6963Info, provider };
}

export class WalletRegistry {
  private readonly host: DiscoveryHost;
  private readonly wallets = new Map<WalletId, WalletCandidate>();
  private readonly providerIds = new Map<Eip1193Provider, WalletId>();
  private readonly uuids = new Set<string>();
  private readonly subscribers = new Set<() => void>();
  private readonly onAnnounce = (event: Event) => {
    const detail = eventDetail(event);
    if (detail) this.register(detail.provider, "eip6963", detail.info);
  };

  constructor(host: DiscoveryHost) {
    this.host = host;
    host.addEventListener(ANNOUNCE_EVENT, this.onAnnounce);
    for (const provider of readLegacyProviders(host)) {
      this.register(provider, "legacy");
    }
    host.dispatchEvent(new Event(REQUEST_EVENT));
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    listener();
    return () => this.subscribers.delete(listener);
  }

  getWallets(): WalletCandidate[] {
    return WALLET_ORDER.flatMap((id) => {
      const wallet = this.wallets.get(id);
      return wallet ? [wallet] : [];
    });
  }

  destroy(): void {
    this.host.removeEventListener(ANNOUNCE_EVENT, this.onAnnounce);
    this.subscribers.clear();
  }

  private notify(): void {
    for (const listener of this.subscribers) listener();
  }

  private register(provider: Eip1193Provider, source: WalletSource, info?: Eip6963Info): void {
    const id = source === "legacy" ? classifyLegacy(provider) : classifyAnnouncement(info);
    if (!id) return;
    if (info && this.uuids.has(info.uuid)) {
      const existing = this.wallets.get(id);
      if (existing && existing.provider === provider && existing.source === "eip6963") {
        this.wallets.set(id, { ...existing, info });
        this.notify();
      }
      return;
    }

    const providerId = this.providerIds.get(provider);
    if (providerId) {
      if (info) this.uuids.add(info.uuid);
      const existing = this.wallets.get(providerId);
      if (existing && existing.source === "legacy" && source === "eip6963") {
        this.wallets.set(providerId, { ...existing, source, info });
        this.notify();
      }
      return;
    }

    const existing = this.wallets.get(id);
    if (existing && existing.source === "eip6963") return;
    if (existing && source === "legacy") return;

    const wallet: WalletCandidate = {
      id,
      name: LABELS[id],
      provider,
      source,
      ...(info ? { info } : {}),
    };
    this.providerIds.set(provider, id);
    if (info) this.uuids.add(info.uuid);
    this.wallets.set(id, wallet);
    this.notify();
  }
}

export function browserDiscoveryHost(): DiscoveryHost {
  return window as unknown as DiscoveryHost;
}

