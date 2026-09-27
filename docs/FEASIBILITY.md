# Pre-lock Contract Feasibility

- Date: 2026-09-21
- Tool: `genvm-lint 0.11.1rc2`; Python 3.14 under WSL; `genlayer-test 0.30.0rc2` Direct Mode
- Candidate: `probes/contract_feasibility.py`
- Exercised: v0.3 source metadata, pinned dependency, one discoverable contract, `gl.u256`, `gl.Address`, `str`, seven fully-instantiated `gl.storage.TreeMap` fields, custom `gl.vm.run_nondet`, `exec_prompt`, validator re-execution, and pickling.

## Verified runner

`py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`

- `genvm-lint check`: PASS after enabling UTF-8 console output.
- `genvm-lint schema`: PASS; constructor and both representative methods discovered with expected ABI families.
- Direct Mode/pickling: PASS; validator captured and independently reran.

The runner is sourced from the official GenVM Manager `v0.6.0-rc5` bundle; asset SHA-256 is recorded in tool readiness.

## Tooling note

On Windows CP1252, `PYTHONUTF8=1` is required for linter output. Direct Mode runs under WSL because `genlayer-test 0.30.0rc2` cannot unlink its replaced-stdin temp file on Windows. Neither workaround alters contract bytes.

## Decision

The approved C11 storage, ABI, and nondeterministic mechanisms are feasible on the Studio Next compatible runtime family without changing Stage 1/2. Live source parity remains a post-approval requirement.
