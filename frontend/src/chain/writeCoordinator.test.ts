// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { executeWrite, reconcileWrite } from "./writeCoordinator";
import { DurableJournal, canonicalJson, journalKey, type JournalStorage, type LockManagerLike } from "../pending";

class MemoryStorage implements JournalStorage {
  private readonly values = new Map<string, string>();
  failWrites = false;
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("storage write failed");
    this.values.set(key, value);
  }
  removeItem(key: string): void { this.values.delete(key); }
}

class ImmediateLocks implements LockManagerLike {
  async request(_name: string, _options: { mode: "exclusive" }, callback: (lock: unknown) => Promise<unknown>): Promise<unknown> {
    return callback({});
  }
}

const journalInput = {
  chain: "61999",
  contract: "0x" + "1".repeat(40),
  account: "0x" + "2".repeat(40),
  method: "evaluate_match",
  intent: "evaluate_match:1:3",
  argsJson: canonicalJson(["1", "3"]),
  preRevision: "3",
  preHash: "a".repeat(64),
};

function plan(overrides: Partial<Parameters<typeof executeWrite>[0]> = {}) {
  return {
    journal: journalInput,
    submit: async () => "0x" + "b".repeat(64),
    pollFinalized: async () => ({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }),
    verifyPost: async () => true,
    verifyPre: async () => false,
    ...overrides,
  };
}

describe("executeWrite", () => {
  it("uses three bounded receipt queries and verifies the historical postcondition", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    const sleeps: number[] = [];
    let polls = 0;
    const outcome = await executeWrite(
      plan({
        pollFinalized: async () => {
          polls += 1;
          return polls === 3 ? { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" } : null;
        },
      }),
        { journal, sleep: async (milliseconds) => { sleeps.push(milliseconds); } },
    );

    expect(outcome.status).toBe("VERIFIED");
    expect(polls).toBe(3);
    expect(sleeps).toEqual([2000, 4000, 8000]);
    expect((await journal.list())[0].status).toBe("VERIFIED");
  });

  it("records a finalized execution error only after pre-state readback", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    let preReads = 0;
    const outcome = await executeWrite(
      plan({
        pollFinalized: async () => ({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }),
        verifyPre: async () => { preReads += 1; return true; },
      }),
      { journal, sleep: async () => undefined },
    );

    expect(outcome.status).toBe("FINALIZED_ERROR");
    expect(preReads).toBe(1);
  });

  it("keeps an unknown finalized execution result in reconcile", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    let preReads = 0;
    const outcome = await executeWrite(
      plan({
        pollFinalized: async () => ({ statusName: "FINALIZED", txExecutionResultName: "NOT_VOTED" }),
        verifyPre: async () => { preReads += 1; return true; },
      }),
      { journal, sleep: async () => undefined },
    );

    expect(outcome.status).toBe("RECONCILE");
    expect(preReads).toBe(0);
    expect((await journal.list())[0].status).toBe("RECONCILE");
  });

  it("classifies a finalized failed write with a competing revision", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    let preReads = 0;
    const outcome = await executeWrite(
      plan({
        pollFinalized: async () => ({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }),
        verifyFinalizedError: async () => ({ classification: "COMPETING", detailJson: canonicalJson({ classification: "COMPETING", revision: "4" }) }),
        verifyPre: async () => { preReads += 1; return true; },
      }),
      { journal, sleep: async () => undefined },
    );

    expect(outcome.status).toBe("FINALIZED_ERROR");
    expect(preReads).toBe(0);
    expect((await journal.list())[0].resolution_json).toBe(canonicalJson({ classification: "COMPETING", revision: "4" }));
  });

  it("keeps unknown finalized-error readback in reconciliation", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    const detailJson = canonicalJson({ classification: "UNKNOWN", reason: "invalid_post_state" });
    const outcome = await executeWrite(
      plan({
        pollFinalized: async () => ({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }),
        verifyFinalizedError: async () => ({ classification: "UNKNOWN", detailJson }),
        verifyPre: async () => true,
      }),
      { journal, sleep: async () => undefined },
    );

    expect(outcome.status).toBe("RECONCILE");
    expect((await journal.list())[0]).toMatchObject({ status: "RECONCILE", resolution_json: detailJson });
  });

  it("keeps unknown finalized-error resume in reconciliation", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    const original = await journal.createSigning(journalInput);
    const submitted = await journal.update(journalKey(original.reservation), {
      ...original,
      status: "RECONCILE",
      tx_hash: "0x" + "b".repeat(64),
    });
    const detailJson = canonicalJson({ classification: "UNKNOWN", reason: "invalid_post_state" });
    const outcome = await reconcileWrite({
      journal: submitted,
      pollFinalized: async () => ({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }),
      verifyPost: async () => false,
      verifyPre: async () => true,
      verifyFinalizedError: async () => ({ classification: "UNKNOWN", detailJson }),
    }, { journal });

    expect(outcome.status).toBe("RECONCILE");
    expect((await journal.list())[0]).toMatchObject({ status: "RECONCILE", resolution_json: detailJson });
  });

  it("latches signing off and retains the returned hash after storage failure", async () => {
    const storage = new MemoryStorage();
    const journal = new DurableJournal(storage, new ImmediateLocks());
    let submitCalls = 0;
    const outcome = await executeWrite(
      plan({
        submit: async () => {
          submitCalls += 1;
          storage.failWrites = true;
          return "0x" + "c".repeat(64);
        },
      }),
      { journal, sleep: async () => undefined },
    );

    expect(outcome.status).toBe("RECONCILE");
    expect(journal.signingAvailable).toBe(false);
    expect((await journal.list())[0]).toMatchObject({ status: "RECONCILE", tx_hash: "0x" + "c".repeat(64) });
    storage.failWrites = false;
    await expect(executeWrite(plan({ submit: async () => { submitCalls += 1; return "0x" + "d".repeat(64); } }), { journal, sleep: async () => undefined })).rejects.toMatchObject({ kind: "lock" });
    expect(submitCalls).toBe(1);
  });

  it("persists a later terminal classification after an unknown finalized-error pass", async () => {
    for (const classification of ["PRESENT", "COMPETING"] as const) {
      const storage = new MemoryStorage();
      const journal = new DurableJournal(storage, new ImmediateLocks());
      const unknownJson = canonicalJson({ classification: "UNKNOWN", reason: "invalid_post_state" });
      const terminalJson = canonicalJson({ classification, revision: "4" });
      const first = await executeWrite(
        plan({
          pollFinalized: async () => ({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }),
          verifyFinalizedError: async () => ({ classification: "UNKNOWN", detailJson: unknownJson }),
        }),
        { journal, sleep: async () => undefined },
      );
      expect(first.status).toBe("RECONCILE");
      const retained = (await journal.list())[0];
      const second = await reconcileWrite({
        journal: retained,
        pollFinalized: async () => ({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }),
        verifyPost: async () => false,
        verifyPre: async () => true,
        verifyFinalizedError: async () => ({ classification, detailJson: terminalJson }),
      }, { journal });
      expect(second.status).toBe("FINALIZED_ERROR");

      const reloaded = new DurableJournal(storage, new ImmediateLocks());
      expect((await reloaded.list())[0]).toMatchObject({ status: "FINALIZED_ERROR", resolution_json: terminalJson });
    }
  });

  it("rejects a concurrent write or reconciliation lifecycle before a second poller starts", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    const hash = "0x" + "e".repeat(64);
    let releaseSubmit: ((value: string) => void) | undefined;
    let markSubmitStarted: (() => void) | undefined;
    const submitStarted = new Promise<void>((resolve) => { markSubmitStarted = resolve; });
    const first = executeWrite(
      plan({
        submit: async () => {
          markSubmitStarted?.();
          return new Promise<string>((resolve) => { releaseSubmit = resolve; });
        },
      }),
      { journal, sleep: async () => undefined },
    );
    await submitStarted;
    const retained = (await journal.list())[0];
    await expect(reconcileWrite({
      journal: retained,
      pollFinalized: async () => ({ statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }),
      verifyPost: async () => true,
      verifyPre: async () => false,
    }, { journal })).rejects.toThrow(/another transaction lifecycle/i);
    releaseSubmit?.(hash);
    await expect(first).resolves.toMatchObject({ status: "VERIFIED" });
  });

  it("latches signing off when the lock request is rejected", async () => {
    const journal = new DurableJournal(new MemoryStorage(), { request: async () => { throw new Error("lock rejected"); } });
    await expect(executeWrite(plan(), { journal, sleep: async () => undefined })).rejects.toMatchObject({ kind: "lock" });
    expect(journal.signingAvailable).toBe(false);
  });

  it("emits the evidence-driven public progress sequence", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    const phases: string[] = [];
    await executeWrite(plan({ progress: ({ phase }) => phases.push(phase) }), { journal, sleep: async () => undefined });
    expect(phases).toEqual([
      "WAITING_FOR_WALLET",
      "SUBMITTED",
      "WAITING_FOR_FINALITY",
      "VERIFYING_EXECUTION",
      "VERIFYING_READBACK",
      "SUCCESS",
    ]);
  });

  it("does one authoritative readback after finality and then preserves reconcile", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    let postReads = 0;
    const outcome = await executeWrite(
      plan({ verifyPost: async () => { postReads += 1; return false; } }),
      { journal, sleep: async () => undefined },
    );

    expect(outcome.status).toBe("RECONCILE");
    expect(postReads).toBe(1);
    expect((await journal.list())[0].status).toBe("RECONCILE");
  });

  it("reconciles an existing hash without submitting again", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    const original = await journal.createSigning(journalInput);
    const hash = "0x" + "b".repeat(64);
    const submitted = await journal.update(journalKey(original.reservation), { ...original, status: "RECONCILE", tx_hash: hash });
    let polls = 0;
    let postReads = 0;
    const outcome = await reconcileWrite({
      journal: submitted,
      pollFinalized: async (sameHash) => {
        polls += 1;
        expect(sameHash).toBe(hash);
        return { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" };
      },
      verifyPost: async () => { postReads += 1; return true; },
      verifyPre: async () => false,
    }, { journal });

    expect(outcome.status).toBe("VERIFIED");
    expect(polls).toBe(1);
    expect(postReads).toBe(1);
    expect((await journal.list())[0].status).toBe("VERIFIED");
  });

  it("retains the submitted hash when session cancellation aborts before the next poll", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    const controller = new AbortController();
    const hash = "0x" + "f".repeat(64);
    let submitCalls = 0;
    let polls = 0;
    let markSubmitStarted: (() => void) | undefined;
    const submitStarted = new Promise<void>((resolve) => { markSubmitStarted = resolve; });
    let releaseSleep: (() => void) | undefined;
    const blockedSleep = new Promise<void>((resolve) => { releaseSleep = resolve; });
    const pending = executeWrite(
      plan({
        submit: async () => { submitCalls += 1; markSubmitStarted?.(); return hash; },
        pollFinalized: async () => { polls += 1; return null; },
      }),
      { journal, signal: controller.signal, sleep: async () => blockedSleep },
    );

    await submitStarted;
    controller.abort();
    const outcome = await pending;
    releaseSleep?.();

    expect(outcome.status).toBe("RECONCILE");
    expect(outcome.journal?.tx_hash).toBe(hash);
    expect(submitCalls).toBe(1);
    expect(polls).toBe(0);
  });

  it("looks up a hashless reservation without polling or submitting", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    const original = await journal.createSigning(journalInput);
    let polls = 0;
    const outcome = await reconcileWrite({
      journal: original,
      pollFinalized: async () => { polls += 1; return null; },
      verifyPost: async () => false,
      verifyPre: async () => false,
      lookupNoHash: async () => ({ classification: "ABSENT", detailJson: canonicalJson({ classification: "ABSENT" }) }),
    }, { journal });

    expect(outcome.status).toBe("RECONCILE");
    expect(polls).toBe(0);
    expect((await journal.list())[0].resolution_json).toBe(canonicalJson({ classification: "ABSENT" }));
  });

  it("pauses same-hash polling while the document is hidden", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    let polls = 0;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const original = await journal.createSigning(journalInput);
    const submitted = await journal.update(journalKey(original.reservation), { ...original, status: "RECONCILE", tx_hash: "0x" + "b".repeat(64) });
    const pending = reconcileWrite({
      journal: submitted,
      pollFinalized: async () => { polls += 1; return { statusName: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }; },
      verifyPost: async () => true,
      verifyPre: async () => false,
    }, { journal, sleep: async () => undefined });

    await Promise.resolve();
    expect(polls).toBe(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await expect(pending).resolves.toMatchObject({ status: "VERIFIED" });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("removes only an unsigned reservation after explicit wallet rejection", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    let submitCalls = 0;
    const outcome = await executeWrite(
      plan({ submit: async () => { submitCalls += 1; throw { code: 4001 }; } }),
      { journal },
    );

    expect(outcome.status).toBe("CANCELLED");
    expect(submitCalls).toBe(1);
    expect(await journal.list()).toHaveLength(0);
  });

  it("preserves an ambiguous no-hash submission as reconcile", async () => {
    const journal = new DurableJournal(new MemoryStorage(), new ImmediateLocks());
    const outcome = await executeWrite(
      plan({ submit: async () => { throw new Error("transport interrupted"); } }),
      { journal },
    );

    expect(outcome.status).toBe("RECONCILE");
    expect((await journal.list())[0].tx_hash).toBe("");
  });

  it("does not call the wallet when the journal lock is unavailable", async () => {
    const journal = new DurableJournal(new MemoryStorage(), null);
    let submitCalls = 0;
    const phases: string[] = [];
    await expect(
      executeWrite(plan({ submit: async () => { submitCalls += 1; return "0x" + "c".repeat(64); }, progress: ({ phase }) => phases.push(phase) }), { journal }),
    ).rejects.toMatchObject({ kind: "lock" });
    expect(submitCalls).toBe(0);
    expect(phases).toEqual([]);
  });
});

