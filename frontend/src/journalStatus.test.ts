import { describe, expect, it } from "vitest";
import { journalStatusLabel } from "./App";
import type { JournalRecord } from "./pending";

const baseRecord: JournalRecord = {
  v: 1,
  reservation: "a".repeat(32),
  chain: "61999",
  contract: "0x" + "1".repeat(40),
  account: "0x" + "2".repeat(40),
  method: "compile_moves",
  intent: "compile_moves:1:3",
  args_json: "[\"1\",\"3\"]",
  pre_revision: "3",
  pre_hash: "a".repeat(64),
  pre_state_json: "",
  tx_hash: "0x" + "b".repeat(64),
  status: "FINALIZED_ERROR",
  created_ms: "1",
  resolution_json: "{}",
};

describe("JournalPanel status labels", () => {
  it("distinguishes every finalized-error readback classification truthfully", () => {
    const labels = (["PRESENT", "UNCHANGED", "COMPETING"] as const).map((classification) => journalStatusLabel({
      ...baseRecord,
      resolution_json: JSON.stringify({ classification }),
    }));

    expect(labels).toEqual([
      "Finalized; expected state present",
      "Finalized; state unchanged",
      "Finalized; competing operation retained",
    ]);
    expect(new Set(labels).size).toBe(3);
  });
});
