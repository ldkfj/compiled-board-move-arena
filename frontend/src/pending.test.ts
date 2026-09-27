// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DurableJournal,
  JOURNAL_INDEX_KEY,
  canonicalJson,
  journalKey,
  type JournalStorage,
  type LockManagerLike,
} from "./pending";

class MemoryStorage implements JournalStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class ImmediateLocks implements LockManagerLike {
  readonly names: string[] = [];

  async request(name: string, _options: { mode: "exclusive" }, callback: (lock: unknown) => Promise<unknown>): Promise<unknown> {
    this.names.push(name);
    return callback({});
  }
}

const CONTRACT = "0x" + "1".repeat(40);
const ACCOUNT = "0x" + "2".repeat(40);

function input(index: number) {
  return {
    chain: "61997",
    contract: CONTRACT,
    account: ACCOUNT,
    method: "create_arena",
    intent: `create:${ACCOUNT}:nonce${index.toString().padStart(2, "0")}`,
    argsJson: canonicalJson([String(index)]),
    preRevision: "0",
    preHash: "0".repeat(64),
    createdMs: String(index),
  };
}

describe("DurableJournal", () => {
  it("writes a reservation before index update and lists records without requiring a lock", async () => {
    const storage = new MemoryStorage();
    const locks = new ImmediateLocks();
    const journal = new DurableJournal(storage, locks);
    const record = await journal.createSigning(input(1));

    expect(storage.getItem(journalKey(record.reservation))).not.toBeNull();
    expect(JSON.parse(storage.getItem(JOURNAL_INDEX_KEY) ?? "[]")).toEqual([journalKey(record.reservation)]);
    storage.removeItem(JOURNAL_INDEX_KEY);
    expect((await journal.list()).map((item) => item.reservation)).toEqual([record.reservation]);
    expect(storage.getItem(JOURNAL_INDEX_KEY)).toBeNull();
    expect(locks.names.every((name) => name === "genlayer-journal-v1")).toBe(true);
  });

  it("keeps records readable and exportable when Web Locks are unavailable", async () => {
    const storage = new MemoryStorage();
    const locked = new DurableJournal(storage, new ImmediateLocks());
    const record = await locked.createSigning(input(1));
    const lockFree = new DurableJournal(storage, null);

    expect(lockFree.signingAvailable).toBe(false);
    expect(await lockFree.list()).toEqual([record]);
  });

  it("preserves malformed raw entries for export and blocks signing", async () => {
    const storage = new MemoryStorage();
    const journal = new DurableJournal(storage, new ImmediateLocks());
    const record = await journal.createSigning(input(1));
    const malformedKey = journalKey("c".repeat(32));
    storage.setItem(malformedKey, "{not-json");

    const snapshot = await journal.snapshot();
    expect(snapshot.records).toEqual([record]);
    expect(snapshot.unknown).toEqual([{ key: malformedKey, raw: "{not-json", error: expect.any(String) }]);
    await expect(journal.createSigning(input(2))).rejects.toMatchObject({ kind: "data" });
  });

  it("quarantines records outside the approved effective schema", async () => {
    const storage = new MemoryStorage();
    const journal = new DurableJournal(storage, new ImmediateLocks());
    const record = await journal.createSigning(input(1));
    const legacy = { ...record } as Record<string, unknown>;
    delete legacy.pre_state_json;
    delete legacy.resolution_json;
    storage.setItem(journalKey(record.reservation), JSON.stringify(legacy));

    const snapshot = await journal.snapshot();
    expect(snapshot.records).toEqual([]);
    expect(snapshot.unknown).toEqual([{ key: journalKey(record.reservation), raw: JSON.stringify(legacy), error: expect.any(String) }]);
    await expect(journal.createSigning(input(2))).rejects.toMatchObject({ kind: "data" });
  });

  it("quarantines duplicate keys at the outer journal-record level", async () => {
    const storage = new MemoryStorage();
    const journal = new DurableJournal(storage, new ImmediateLocks());
    const record = await journal.createSigning(input(1));
    const key = journalKey(record.reservation);
    const raw = JSON.stringify(record).replace('"tx_hash":"","status"', '"tx_hash":"","tx_hash":"","status"');
    storage.setItem(key, raw);

    const snapshot = await journal.snapshot();
    expect(snapshot.records).toEqual([]);
    expect(snapshot.unknown).toEqual([{ key, raw, error: expect.stringContaining("duplicate") }]);
    await expect(journal.createSigning(input(2))).rejects.toMatchObject({ kind: "data" });
  });

  it("quarantines duplicate keys inside canonical nested journal JSON", async () => {
    const storage = new MemoryStorage();
    const journal = new DurableJournal(storage, new ImmediateLocks());
    const record = await journal.createSigning(input(1));
    const key = journalKey(record.reservation);
    const nested = { ...record, args_json: '{"answer":"one","answer":"two"}' };
    const raw = JSON.stringify(nested);
    storage.setItem(key, raw);

    const snapshot = await journal.snapshot();
    expect(snapshot.records).toEqual([]);
    expect(snapshot.unknown).toEqual([{ key, raw, error: expect.any(String) }]);
    await expect(journal.createSigning(input(2))).rejects.toMatchObject({ kind: "data" });
  });

  it("blocks a second pending write for the same case even with another account or method", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    await journal.createSigning({
      ...input(1),
      method: "compile_moves",
      intent: "compile_moves:7:3",
      argsJson: canonicalJson(["7", "3"]),
      preRevision: "3",
      preHash: "a".repeat(64),
    });

    await expect(
      journal.createSigning({
        ...input(2),
        account: "0x" + "3".repeat(40),
        method: "cancel_arena",
        intent: "cancel_arena:7:3",
        argsJson: canonicalJson(["7", "3"]),
        preRevision: "3",
        preHash: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("keeps a nonempty transaction hash immutable", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    const record = await journal.createSigning(input(1));
    const hash = "0x" + "a".repeat(64);
    await journal.update(journalKey(record.reservation), { ...record, status: "SUBMITTED", tx_hash: hash });

    await expect(
      journal.update(journalKey(record.reservation), {
        ...record,
        status: "RECONCILE",
        tx_hash: "0x" + "b".repeat(64),
      }),
    ).rejects.toMatchObject({ kind: "data" });
  });

  it("fails signing when Web Locks are unavailable", async () => {
    const journal = new DurableJournal(new MemoryStorage(), null);
    await expect(journal.createSigning(input(1))).rejects.toMatchObject({ kind: "lock" });
  });

  it("blocks the 33rd journal record", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    for (let index = 1; index <= 32; index += 1) await journal.createSigning(input(index));
    await expect(journal.createSigning(input(33))).rejects.toMatchObject({ kind: "capacity" });
  });
});
