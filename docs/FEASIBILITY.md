# Pre-lock Contract Feasibility

- Date: 2026-09-07
- Tool: `genvm-lint 0.11.0`; Python 3.13; `genlayer-test` Direct Mode
- Candidate: `probes/contract_feasibility.py`
- Exercised: first-line runner metadata, pinned dependency, one discoverable contract, `u256`, `Address`, `str`, seven fully-instantiated `TreeMap` fields, custom `run_nondet_unsafe`, `exec_prompt`, validator re-execution, and pickling.

## Verified runner

`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`

- `genvm-lint check`: PASS after enabling UTF-8 console output.
- `genvm-lint schema`: PASS; constructor and both representative methods discovered with expected ABI families.
- Direct Mode/pickling: PASS; validator captured and independently reran.

## Rejected candidate runner

The linter advertised `1zr6nqk597d97kg0dyxg0shhrykx5v02zjgnyrajapy4wlqvfvwh` as newer. A bounded probe rejected it for this Build environment: SDK validation failed with `No module named 'genlayer.py'`; Direct Mode selected `v0.3.0-rc7` and failed while importing the runner with `genlayer.calldata.DecodingError: unexpected end of memory`. It is not used.

## Tooling note

On Windows CP1252, successful `genvm-lint check` crashed while printing its Unicode check mark. `PYTHONUTF8=1` fixes only output encoding; it does not alter contract bytes or validation behavior.

## Decision

The approved C11 storage, ABI, and nondeterministic mechanisms are feasible without changing Stage 1/2. The verified older runner remains pinned. Studio's current source-envelope parser will still be checked read-only before PRE_DEPLOY.
