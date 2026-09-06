import { isSuccessfulReceipt, type ContractReceipt } from "../contract";
import {
  DurableJournal,
  journalKey,
  type JournalRecord,
  type SigningInput,
} from "../pending";

export interface WritePlan {
  journal: SigningInput;
  submit: () => Promise<string>;
  pollFinalized: (hash: string, attempt: number, signal?: AbortSignal) => Promise<ContractReceipt | null>;
  verifyPost: (signal?: AbortSignal) => Promise<boolean>;
  verifyPre: (signal?: AbortSignal) => Promise<boolean>;
  verifyFinalizedError?: (signal?: AbortSignal) => Promise<ResolutionEvidence | null>;
  progress?: (event: WriteProgress) => void;
}

export interface ReconcilePlan {
  journal: JournalRecord;
  pollFinalized: (hash: string, attempt: number, signal?: AbortSignal) => Promise<ContractReceipt | null>;
  verifyPost: (signal?: AbortSignal) => Promise<boolean>;
  verifyPre: (signal?: AbortSignal) => Promise<boolean>;
  verifyFinalizedError?: (signal?: AbortSignal) => Promise<ResolutionEvidence | null>;
  lookupNoHash?: (signal?: AbortSignal) => Promise<ResolutionEvidence | null>;
  progress?: (event: WriteProgress) => void;
}

export type ResolutionClass = "UNCHANGED" | "COMPETING" | "PRESENT" | "ABSENT" | "UNKNOWN";

export type WritePhase =
  | "IDLE"
  | "WAITING_FOR_WALLET"
  | "SUBMITTED"
  | "WAITING_FOR_FINALITY"
  | "VERIFYING_EXECUTION"
  | "VERIFYING_READBACK"
  | "SUCCESS"
  | "REJECTED"
  | "FAILED"
  | "RECONCILIATION_REQUIRED";

export interface WriteProgress {
  phase: WritePhase;
  hash?: string;
  message?: string;
  persistenceDegraded?: boolean;
}

export const INITIAL_WRITE_PROGRESS: WriteProgress = { phase: "IDLE" };

export interface ResolutionEvidence {
  classification: ResolutionClass;
  detailJson: string;
}

export type WriteOutcome =
  | { status: "CANCELLED"; journal: null }
  | { status: "RECONCILE"; journal: JournalRecord }
  | { status: "FINALIZED_ERROR"; journal: JournalRecord; receipt: ContractReceipt }
  | { status: "VERIFIED"; journal: JournalRecord; receipt: ContractReceipt };

export interface CoordinatorOptions {
  journal: DurableJournal;
  sleep?: (milliseconds: number) => Promise<void>;
  receiptDelays?: readonly number[];
  signal?: AbortSignal;
}

const DEFAULT_RECEIPT_DELAYS = [2000, 4000, 8000] as const;
const MAX_RECEIPT_QUERIES = 3;
const MAX_RETRY_AFTER_MS = 60_000;

function isUserRejected(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 4001 || code === "4001") return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("user rejected") || message.includes("user denied") || message.includes("denied transaction");
}

function normalizeHash(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Wallet did not return a usable transaction hash.");
  }
  return value.toLowerCase();
}

async function safeCheck(check: (signal?: AbortSignal) => Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  try {
    if (signal?.aborted) return false;
    const result = await check(signal);
    return !signal?.aborted && result;
  } catch {
    return false;
  }
}

async function safeResolution(check: ((signal?: AbortSignal) => Promise<ResolutionEvidence | null>) | undefined, signal?: AbortSignal): Promise<ResolutionEvidence | null> {
  if (!check) return null;
  try {
    if (signal?.aborted) return null;
    const result = await check(signal);
    return signal?.aborted ? null : result;
  } catch {
    return null;
  }
}

function abortError(): Error {
  return new Error("Transaction reconciliation was cancelled.");
}

async function wait(
  sleep: (milliseconds: number) => Promise<void>,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await sleep(milliseconds);
    return;
  }
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void sleep(milliseconds).then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }).catch((error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

async function waitUntilVisible(signal?: AbortSignal): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") return;
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") {
        cleanup();
        resolve();
      }
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      signal?.removeEventListener("abort", onAbort);
    };
    document.addEventListener("visibilitychange", onVisibility);
    signal?.addEventListener("abort", onAbort, { once: true });
    onVisibility();
  });
}

function retryAfterMilliseconds(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as {
    retryAfterMs?: unknown;
    retryAfter?: unknown;
    status?: unknown;
    response?: { headers?: { get?: (name: string) => string | null } };
    headers?: { get?: (name: string) => string | null };
  };
  const raw = candidate.retryAfterMs ?? candidate.retryAfter ?? candidate.response?.headers?.get?.("Retry-After") ?? candidate.headers?.get?.("Retry-After");
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.min(Math.round(raw), MAX_RETRY_AFTER_MS);
  if (typeof raw === "string") {
    const seconds = Number(raw.trim());
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), MAX_RETRY_AFTER_MS);
  }
  return candidate.status === 429 ? 1000 : null;
}

function delayedRetry(baseMilliseconds: number, error: unknown): number {
  const retryAfter = retryAfterMilliseconds(error);
  if (retryAfter === null) return baseMilliseconds;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(baseMilliseconds, retryAfter) + Math.floor(Math.random() * 200));
}

function isTerminalResolution(evidence: ResolutionEvidence): boolean {
  return evidence.classification === "UNCHANGED" || evidence.classification === "PRESENT" || evidence.classification === "COMPETING";
}

function emitProgress(progress: ((event: WriteProgress) => void) | undefined, event: WriteProgress): void {
  progress?.(event);
}

async function updateStatus(
  journal: DurableJournal,
  current: JournalRecord,
  status: JournalRecord["status"],
  resolutionJson?: string,
): Promise<JournalRecord> {
  return journal.update(journalKey(current.reservation), {
    ...current,
    status,
    ...(resolutionJson !== undefined ? { resolution_json: resolutionJson } : {}),
  });
}

let lifecycleInFlight = false;

function enterLifecycle(): void {
  if (lifecycleInFlight) throw new Error("Another transaction lifecycle is already active.");
  lifecycleInFlight = true;
}

function leaveLifecycle(): void {
  lifecycleInFlight = false;
}

export async function executeWrite(plan: WritePlan, options: CoordinatorOptions): Promise<WriteOutcome> {
  enterLifecycle();
  try {
    return await executeWriteInternal(plan, options);
  } finally {
    leaveLifecycle();
  }
}

async function executeWriteInternal(plan: WritePlan, options: CoordinatorOptions): Promise<WriteOutcome> {
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const receiptDelays = [...(options.receiptDelays ?? DEFAULT_RECEIPT_DELAYS)].slice(0, MAX_RECEIPT_QUERIES);
  let current = await options.journal.createSigning(plan.journal);
  const key = journalKey(current.reservation);
  let transactionHash: string | null = null;

  const update = async (status: JournalRecord["status"], fields: { txHash?: string; resolutionJson?: string } = {}): Promise<void> => {
    current = await options.journal.update(key, {
      ...current,
      status,
      ...(fields.txHash !== undefined ? { tx_hash: fields.txHash } : {}),
      ...(fields.resolutionJson !== undefined ? { resolution_json: fields.resolutionJson } : {}),
    });
  };

  const retainReconciliation = async (message?: string, resolutionJson?: string): Promise<JournalRecord> => {
    const fallback: JournalRecord = {
      ...current,
      status: "RECONCILE",
      ...(transactionHash !== null ? { tx_hash: transactionHash } : {}),
      ...(resolutionJson !== undefined ? { resolution_json: resolutionJson } : {}),
    };
    try {
      await update("RECONCILE", {
        ...(transactionHash !== null ? { txHash: transactionHash } : {}),
        ...(resolutionJson !== undefined ? { resolutionJson } : {}),
      });
    } catch {
      current = fallback;
      options.journal.rememberRecovery(current);
    }
    emitProgress(plan.progress, {
      phase: "RECONCILIATION_REQUIRED",
      ...(transactionHash !== null ? { hash: transactionHash } : {}),
      ...(message ? { message } : {}),
      ...(transactionHash !== null ? { persistenceDegraded: !options.journal.signingAvailable } : {}),
    });
    return current;
  };

  try {
    emitProgress(plan.progress, { phase: "WAITING_FOR_WALLET" });
    if (options.signal?.aborted) throw abortError();
    transactionHash = normalizeHash(await plan.submit());
    emitProgress(plan.progress, { phase: "SUBMITTED", hash: transactionHash });
    try {
      await update("SUBMITTED", { txHash: transactionHash });
    } catch (error) {
      current = { ...current, status: "RECONCILE", tx_hash: transactionHash };
      options.journal.rememberRecovery(current);
      emitProgress(plan.progress, {
        phase: "RECONCILIATION_REQUIRED",
        hash: transactionHash,
        message: error instanceof Error ? error.message : "The transaction hash could not be persisted.",
        persistenceDegraded: true,
      });
      return { status: "RECONCILE", journal: current };
    }
  } catch (error) {
    if (isUserRejected(error)) {
      try {
        await options.journal.removeUnsigned(key);
        emitProgress(plan.progress, { phase: "REJECTED", message: "The wallet request was rejected. No transaction was submitted." });
        return { status: "CANCELLED", journal: null };
      } catch (cleanupError) {
        const retained = await retainReconciliation(cleanupError instanceof Error ? cleanupError.message : "The rejected request could not be removed from the journal.");
        return { status: "RECONCILE", journal: retained };
      }
    }
    const retained = await retainReconciliation(error instanceof Error ? error.message : "The wallet submission could not be verified.");
    return { status: "RECONCILE", journal: retained };
  }

  let receipt: ContractReceipt | null = null;
  let nextDelay = receiptDelays[0] ?? 0;
  emitProgress(plan.progress, { phase: "WAITING_FOR_FINALITY", hash: transactionHash });
  for (let index = 0; index < receiptDelays.length; index += 1) {
    try {
      await waitUntilVisible(options.signal);
      await wait(sleep, nextDelay, options.signal);
      await waitUntilVisible(options.signal);
    } catch (error) {
      const retained = await retainReconciliation(error instanceof Error ? error.message : "Finality polling was interrupted.");
      return { status: "RECONCILE", journal: retained };
    }
    try {
      const candidate = await plan.pollFinalized(transactionHash, index + 1, options.signal);
      if (candidate && candidate.statusName === "FINALIZED") {
        receipt = candidate;
        break;
      }
    } catch (error) {
      if (index + 1 < receiptDelays.length) nextDelay = delayedRetry(receiptDelays[index + 1], error);
    }
    if (index + 1 < receiptDelays.length && nextDelay === receiptDelays[index]) nextDelay = receiptDelays[index + 1];
  }

  if (!receipt) {
    const retained = await retainReconciliation("Finality was not observed within the bounded polling window.");
    return { status: "RECONCILE", journal: retained };
  }

  emitProgress(plan.progress, { phase: "VERIFYING_EXECUTION", hash: transactionHash });
  if (isSuccessfulReceipt(receipt)) {
    emitProgress(plan.progress, { phase: "VERIFYING_READBACK", hash: transactionHash });
    if (await safeCheck(plan.verifyPost, options.signal)) {
      try {
        await update("VERIFIED");
        emitProgress(plan.progress, { phase: "SUCCESS", hash: transactionHash });
        return { status: "VERIFIED", journal: current, receipt };
      } catch (error) {
        const retained = await retainReconciliation(error instanceof Error ? error.message : "The verified result could not be persisted.");
        return { status: "RECONCILE", journal: retained };
      }
    }
    const retained = await retainReconciliation("Authoritative readback did not prove the expected transition.");
    return { status: "RECONCILE", journal: retained };
  }

  if (receipt.txExecutionResultName === "FINISHED_WITH_ERROR") {
    emitProgress(plan.progress, { phase: "VERIFYING_READBACK", hash: transactionHash });
    const evidence = await safeResolution(plan.verifyFinalizedError, options.signal);
    if (evidence && isTerminalResolution(evidence)) {
      try {
        await update("FINALIZED_ERROR", { resolutionJson: evidence.detailJson });
        emitProgress(plan.progress, { phase: "FAILED", hash: transactionHash, message: "The finalized transaction did not complete successfully." });
        return { status: "FINALIZED_ERROR", journal: current, receipt };
      } catch (error) {
        const retained = await retainReconciliation(error instanceof Error ? error.message : "The finalized failure could not be persisted.", evidence.detailJson);
        return { status: "RECONCILE", journal: retained };
      }
    }
    if (evidence) {
      const retained = await retainReconciliation("The finalized result is still ambiguous; continue verification of the existing transaction.", evidence.detailJson);
      return { status: "RECONCILE", journal: retained };
    }
    if (!plan.verifyFinalizedError && await safeCheck(plan.verifyPre, options.signal)) {
      try {
        await update("FINALIZED_ERROR", { resolutionJson: '{"classification":"UNCHANGED"}' });
        emitProgress(plan.progress, { phase: "FAILED", hash: transactionHash, message: "The finalized transaction did not complete successfully and the authoritative pre-state was unchanged." });
        return { status: "FINALIZED_ERROR", journal: current, receipt };
      } catch (error) {
        const retained = await retainReconciliation(error instanceof Error ? error.message : "The finalized failure could not be persisted.");
        return { status: "RECONCILE", journal: retained };
      }
    }
  }
  const retained = await retainReconciliation("The finalized transaction still requires authoritative reconciliation.");
  return { status: "RECONCILE", journal: retained };
}

export async function reconcileWrite(plan: ReconcilePlan, options: CoordinatorOptions): Promise<WriteOutcome> {
  enterLifecycle();
  try {
    return await reconcileWriteInternal(plan, options);
  } finally {
    leaveLifecycle();
  }
}

async function reconcileWriteInternal(plan: ReconcilePlan, options: CoordinatorOptions): Promise<WriteOutcome> {
  let current = plan.journal;
  const retainReconciliation = async (message?: string, resolutionJson?: string): Promise<JournalRecord> => {
    const fallback: JournalRecord = {
      ...current,
      status: "RECONCILE",
      ...(resolutionJson !== undefined ? { resolution_json: resolutionJson } : {}),
    };
    try {
      current = await updateStatus(options.journal, current, "RECONCILE", resolutionJson);
    } catch {
      current = fallback;
      options.journal.rememberRecovery(current);
    }
    emitProgress(plan.progress, {
      phase: "RECONCILIATION_REQUIRED",
      ...(current.tx_hash !== "" ? { hash: current.tx_hash } : {}),
      ...(message ? { message } : {}),
      ...(current.tx_hash !== "" ? { persistenceDegraded: !options.journal.signingAvailable } : {}),
    });
    return current;
  };

  if (plan.journal.tx_hash === "") {
    emitProgress(plan.progress, { phase: "RECONCILIATION_REQUIRED", message: "No transaction hash is available; no replacement will be sent." });
    const evidence = await safeResolution(plan.lookupNoHash, options.signal);
    if (!evidence) return { status: "RECONCILE", journal: current };
    const journal = await retainReconciliation("The hashless operation remains preserved for reconciliation.", evidence.detailJson);
    return { status: "RECONCILE", journal };
  }
  let receipt: ContractReceipt | null = null;
  emitProgress(plan.progress, { phase: "WAITING_FOR_FINALITY", hash: current.tx_hash });
  try {
    await waitUntilVisible(options.signal);
    receipt = await plan.pollFinalized(current.tx_hash, 1, options.signal);
  } catch (error) {
    const journal = await retainReconciliation(error instanceof Error ? error.message : "Finality polling was interrupted.");
    return { status: "RECONCILE", journal };
  }
  if (!receipt || receipt.statusName !== "FINALIZED") {
    const journal = await retainReconciliation("The retained transaction is not finalized yet; no replacement will be sent.");
    return { status: "RECONCILE", journal };
  }

  emitProgress(plan.progress, { phase: "VERIFYING_EXECUTION", hash: current.tx_hash });
  if (isSuccessfulReceipt(receipt)) {
    emitProgress(plan.progress, { phase: "VERIFYING_READBACK", hash: current.tx_hash });
    if (await safeCheck(plan.verifyPost, options.signal)) {
      try {
        current = await updateStatus(options.journal, current, "VERIFIED");
        emitProgress(plan.progress, { phase: "SUCCESS", hash: current.tx_hash });
        return { status: "VERIFIED", journal: current, receipt };
      } catch {
        const journal = await retainReconciliation("The verified result could not be persisted.");
        return { status: "RECONCILE", journal };
      }
    }
  } else if (receipt.txExecutionResultName === "FINISHED_WITH_ERROR") {
    emitProgress(plan.progress, { phase: "VERIFYING_READBACK", hash: current.tx_hash });
    const evidence = await safeResolution(plan.verifyFinalizedError, options.signal);
    if (evidence && isTerminalResolution(evidence)) {
      try {
        current = await updateStatus(options.journal, current, "FINALIZED_ERROR", evidence.detailJson);
        emitProgress(plan.progress, { phase: "FAILED", hash: current.tx_hash, message: "The finalized transaction did not complete successfully." });
        return { status: "FINALIZED_ERROR", journal: current, receipt };
      } catch {
        const journal = await retainReconciliation("The finalized failure could not be persisted.", evidence.detailJson);
        return { status: "RECONCILE", journal };
      }
    }
    if (evidence) {
      const journal = await retainReconciliation("The finalized result is still ambiguous; continue verification of the existing transaction.", evidence.detailJson);
      return { status: "RECONCILE", journal };
    }
    if (!plan.verifyFinalizedError && await safeCheck(plan.verifyPre, options.signal)) {
      try {
        current = await updateStatus(options.journal, current, "FINALIZED_ERROR", '{"classification":"UNCHANGED"}');
        emitProgress(plan.progress, { phase: "FAILED", hash: current.tx_hash, message: "The finalized transaction did not complete successfully and the authoritative pre-state was unchanged." });
        return { status: "FINALIZED_ERROR", journal: current, receipt };
      } catch {
        const journal = await retainReconciliation("The finalized failure could not be persisted.");
        return { status: "RECONCILE", journal };
      }
    }
  }

  const journal = await retainReconciliation("The retained transaction still requires authoritative reconciliation.");
  return { status: "RECONCILE", journal };
}

