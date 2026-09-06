import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransactionProgress } from "./components/TransactionProgress";
import type { WritePhase, WriteProgress } from "./chain/writeCoordinator";

const HASH = `0x${"a".repeat(64)}`;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderProgress(progress: WriteProgress, props: { explorerUrl?: string; onReconcile?: () => void } = {}): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(createElement(TransactionProgress, { progress, ...props }));
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("public transaction progress", () => {
  it("renders every required phase with pending-only motion", () => {
    const pending: WritePhase[] = [
      "WAITING_FOR_WALLET",
      "SUBMITTED",
      "WAITING_FOR_FINALITY",
      "VERIFYING_EXECUTION",
      "VERIFYING_READBACK",
    ];
    for (const phase of pending) {
      const current = renderProgress({ phase, hash: HASH });
      expect(current.querySelector(`[data-transaction-phase="${phase}"]`)).not.toBeNull();
      expect(current.querySelector(".transaction-progress__spinner")).not.toBeNull();
      act(() => root?.unmount());
      current.remove();
      root = null;
      container = null;
    }

    const terminal: WritePhase[] = ["SUCCESS", "REJECTED", "FAILED", "RECONCILIATION_REQUIRED"];
    for (const phase of terminal) {
      const current = renderProgress({ phase, hash: HASH });
      expect(current.querySelector(`[data-transaction-phase="${phase}"]`)).not.toBeNull();
      expect(current.querySelector(".transaction-progress__spinner")).toBeNull();
      act(() => root?.unmount());
      current.remove();
      root = null;
      container = null;
    }
  });

  it("keeps the hash visible, copies it and exposes the verified Explorer URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const explorerUrl = `https://explorer-studio.genlayer.com/tx/${HASH}`;
    const current = renderProgress({ phase: "SUBMITTED", hash: HASH }, { explorerUrl });
    expect(current.textContent).toContain(HASH);
    expect(current.querySelector("a")?.getAttribute("href")).toBe(explorerUrl);
    const copyButton = current.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(HASH);
    expect(current.textContent).toContain("Copied");
  });

  it("announces failures and offers only safe reconciliation", () => {
    const failed = renderProgress({ phase: "FAILED", hash: HASH });
    expect(failed.querySelector('[role="alert"]')).not.toBeNull();
    act(() => root?.unmount());
    failed.remove();
    root = null;
    container = null;

    const reconcile = vi.fn();
    const current = renderProgress({ phase: "RECONCILIATION_REQUIRED", hash: HASH }, { onReconcile: reconcile });
    const button = Array.from(current.querySelectorAll("button")).find((item) => item.textContent?.includes("Continue verification")) as HTMLButtonElement;
    expect(button).toBeDefined();
    expect(button.textContent).toContain("Continue verification");
    button.click();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("does not display success before readback", () => {
    for (const phase of [
      "WAITING_FOR_WALLET",
      "SUBMITTED",
      "WAITING_FOR_FINALITY",
      "VERIFYING_EXECUTION",
      "VERIFYING_READBACK",
    ] as const) {
      const current = renderProgress({ phase, hash: HASH });
      expect(current.textContent).not.toContain("Transaction complete");
      act(() => root?.unmount());
      current.remove();
      root = null;
      container = null;
    }
  });
});

