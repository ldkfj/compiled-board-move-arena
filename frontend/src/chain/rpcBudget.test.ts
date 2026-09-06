import { describe, expect, it, vi } from "vitest";
import { createRpcBudgetGuard, rpcKey } from "./rpcBudget";

const signal = () => new AbortController().signal;

describe("frontend RPC budget guard", () => {
  it("deduplicates identical in-flight reads and records cache hit/miss evidence", async () => {
    const budget = createRpcBudgetGuard([{ id: "read", maxRequests: 4, maxRetries: 0, baseBackoffMs: 1, cacheTtlMs: 1000 }]);
    let resolveRead: ((value: string) => void) | undefined;
    const call = vi.fn(() => new Promise<string>((resolve) => { resolveRead = resolve; }));
    const first = budget.request({ rowId: "read", key: "same", signal: signal(), call });
    const second = budget.request({ rowId: "read", key: "same", signal: signal(), call });
    expect(call).toHaveBeenCalledOnce();
    expect(budget.evidence().some(({ source }) => source === "in-flight")).toBe(true);
    resolveRead?.("value");
    await expect(Promise.all([first, second])).resolves.toEqual(["value", "value"]);
    await expect(budget.request({ rowId: "read", key: "same", signal: signal(), call })).resolves.toBe("value");
    expect(call).toHaveBeenCalledOnce();
    expect(budget.evidence().some(({ source }) => source === "cache")).toBe(true);
  });

  it("separates RPC keys and enforces the matrix budget", async () => {
    const budget = createRpcBudgetGuard([{ id: "one-call", maxRequests: 1, maxRetries: 0, baseBackoffMs: 1, cacheTtlMs: 0 }]);
    expect(rpcKey({ chainId: 61999, contract: `0x${"a".repeat(40)}`, method: "get_case", args: ["1"] })).not.toBe(
      rpcKey({ chainId: 61999, contract: `0x${"a".repeat(40)}`, method: "get_case", args: ["2"] }),
    );
    await budget.request({ rowId: "one-call", key: "a", signal: signal(), call: async () => 1 });
    await expect(budget.request({ rowId: "one-call", key: "b", signal: signal(), call: async () => 2 })).rejects.toThrow("RPC budget exceeded");
  });

  it("uses bounded retry/backoff and honors Retry-After", async () => {
    const budget = createRpcBudgetGuard([{ id: "retryable", maxRequests: 2, maxRetries: 1, baseBackoffMs: 1, cacheTtlMs: 0 }]);
    const call = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("limited"), { status: 429, retryAfterMs: 0 }))
      .mockResolvedValue("ok");
    await expect(budget.request({ rowId: "retryable", key: "limited", signal: signal(), call })).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("aborts bounded polling on teardown and never auto-resubmits", async () => {
    const budget = createRpcBudgetGuard([{ id: "status", maxRequests: 2, maxRetries: 0, baseBackoffMs: 1, cacheTtlMs: 0 }]);
    const controller = new AbortController();
    const pending = budget.poll({
      rowId: "status", key: "tx", signal: controller.signal, intervalMs: 20, maxPolls: 2,
      call: async () => "PENDING", terminal: (status) => status === "FINALIZED",
    });
    controller.abort(new Error("unmounted"));
    await expect(pending).rejects.toThrow("unmounted");

    const submit = vi.fn();
    await expect(budget.poll({
      rowId: "status", key: "other", signal: signal(), intervalMs: 1, maxPolls: 1,
      call: async () => "PENDING", terminal: (status) => status === "FINALIZED",
    })).rejects.toThrow(/do not resubmit/i);
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps measured totals stable across a React Strict Mode-style rerender", async () => {
    const budget = createRpcBudgetGuard([{ id: "measured", maxRequests: 2, maxRetries: 0, baseBackoffMs: 1, cacheTtlMs: 0 }]);
    const call = vi.fn(async () => "value");
    await Promise.all([
      budget.request({ rowId: "measured", key: "same", signal: signal(), call }),
      budget.request({ rowId: "measured", key: "same", signal: signal(), call }),
    ]);
    expect(call).toHaveBeenCalledOnce();
    expect(budget.counts()).toEqual({ measured: 1 });
  });

  it("does not let one aborted caller poison a later same-key caller", async () => {
    const budget = createRpcBudgetGuard([{ id: "read", maxRequests: 2, maxRetries: 0, baseBackoffMs: 1, cacheTtlMs: 0 }]);
    const firstController = new AbortController();
    let resolveRead: ((value: string) => void) | undefined;
    const call = vi.fn(() => new Promise<string>((resolve) => { resolveRead = resolve; }));
    const first = budget.request({ rowId: "read", key: "same", signal: firstController.signal, call });
    await Promise.resolve();
    firstController.abort(new Error("first caller ended"));
    const second = budget.request({ rowId: "read", key: "same", signal: signal(), call });
    resolveRead?.("valid");

    await expect(first).rejects.toThrow("first caller ended");
    await expect(second).resolves.toBe("valid");
    expect(call).toHaveBeenCalledOnce();
    expect(budget.counts()).toEqual({ read: 1 });
  });

  it("does not start an RPC operation for a pre-aborted caller", async () => {
    const budget = createRpcBudgetGuard([{ id: "read", maxRequests: 1, maxRetries: 0, baseBackoffMs: 1, cacheTtlMs: 0 }]);
    const controller = new AbortController();
    controller.abort(new Error("stale session"));
    const call = vi.fn(async () => "should not run");

    await expect(budget.request({ rowId: "read", key: "fresh", signal: controller.signal, call })).rejects.toThrow("stale session");
    expect(call).not.toHaveBeenCalled();
    expect(budget.counts()).toEqual({});
  });

  it("rotates an invalidated in-flight key before a new caller joins", async () => {
    const budget = createRpcBudgetGuard([{ id: "read", maxRequests: 2, maxRetries: 0, baseBackoffMs: 1, cacheTtlMs: 0 }]);
    const values: Array<(value: string) => void> = [];
    const call = vi.fn(() => new Promise<string>((resolve) => { values.push(resolve); }));
    const first = budget.request({ rowId: "read", key: "same", signal: signal(), call });
    await Promise.resolve();
    budget.invalidate(() => true);
    const second = budget.request({ rowId: "read", key: "same", signal: signal(), call });
    expect(call).toHaveBeenCalledTimes(2);
    values[0]?.("stale");
    values[1]?.("fresh");
    await expect(first).resolves.toBe("stale");
    await expect(second).resolves.toBe("fresh");
    expect(budget.counts()).toEqual({ read: 2 });
  });
});

