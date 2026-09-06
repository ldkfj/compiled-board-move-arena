import { useEffect, useState } from "react";
import type { WritePhase, WriteProgress } from "../chain/writeCoordinator";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const PENDING_PHASES = new Set<WritePhase>([
  "WAITING_FOR_WALLET",
  "SUBMITTED",
  "WAITING_FOR_FINALITY",
  "VERIFYING_EXECUTION",
  "VERIFYING_READBACK",
]);

const COPY: Record<WritePhase, { title: string; detail: string }> = {
  IDLE: { title: "Ready", detail: "No transaction is in progress." },
  WAITING_FOR_WALLET: {
    title: "Confirm in your wallet",
    detail: "Review the request and confirm or reject it in your wallet.",
  },
  SUBMITTED: {
    title: "Transaction submitted",
    detail: "Your wallet returned a transaction hash.",
  },
  WAITING_FOR_FINALITY: {
    title: "Waiting for finality",
    detail: "The network is reaching consensus on this transaction.",
  },
  VERIFYING_EXECUTION: {
    title: "Verifying execution",
    detail: "The transaction is finalized; its execution result is being checked.",
  },
  VERIFYING_READBACK: {
    title: "Verifying the result",
    detail: "The finalized result is being compared with the contract state.",
  },
  SUCCESS: {
    title: "Transaction complete",
    detail: "Finality, execution, and the resulting contract state were verified.",
  },
  REJECTED: {
    title: "Request rejected",
    detail: "No transaction was submitted. You can review the form and try again.",
  },
  FAILED: {
    title: "Transaction failed",
    detail: "The finalized transaction did not complete successfully.",
  },
  RECONCILIATION_REQUIRED: {
    title: "Verification interrupted",
    detail: "Do not submit again. Continue verification of the existing transaction.",
  },
};

export function TransactionProgress({
  progress,
  explorerUrl,
  onReconcile,
}: {
  progress: WriteProgress;
  explorerUrl?: string;
  onReconcile?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  if (progress.phase === "IDLE") return null;

  const pending = PENDING_PHASES.has(progress.phase);
  const alert = progress.phase === "FAILED" || progress.phase === "REJECTED";
  const copy = COPY[progress.phase];
  const canReconcile = progress.phase === "RECONCILIATION_REQUIRED" && Boolean(onReconcile);

  async function copyHash() {
    if (!progress.hash || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(progress.hash);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      className={`transaction-progress transaction-progress--${progress.phase.toLowerCase()}`}
      data-transaction-phase={progress.phase}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div className="transaction-progress__heading">
        {pending && <span className="transaction-progress__spinner" aria-hidden="true" />}
        <div>
          <span className="transaction-progress__phase">{progress.phase}</span>
          <strong>{copy.title}</strong>
          <p>{copy.detail}</p>
          {progress.message && <p className="transaction-progress__message">{progress.message}</p>}
        </div>
      </div>

      {progress.hash && (
        <div className="transaction-progress__hash">
          <span>Transaction hash</span>
          <code>{progress.hash}</code>
          <div className="transaction-progress__actions">
            <button type="button" onClick={() => void copyHash()} disabled={!navigator.clipboard}>
              {copied ? "Copied" : "Copy hash"}
            </button>
            {explorerUrl && (
              <a href={explorerUrl} target="_blank" rel="noreferrer">
                View transaction
              </a>
            )}
          </div>
        </div>
      )}

      {progress.persistenceDegraded && (
        <p className="transaction-progress__warning">Keep this page open until verification finishes. Do not submit again.</p>
      )}
      {canReconcile && (
        <button className="secondary-button" type="button" onClick={onReconcile}>
          Continue verification
        </button>
      )}
    </section>
  );
}

