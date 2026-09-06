# PRE_DEPLOY Review Package

PACKAGE_ID: CBMA-PREDEPLOY-10BE629-D9396C48
PACKAGE_STATUS: READY_FOR_ANONYMOUS_REVIEW
CHECKPOINT: PRE_DEPLOY
REVISION: `10be6291350c84bf0aa8c64a2be2fb29e3f0d426`

## Product and acceptance boundary

Player A freezes one bounded public coordinate rule. GenLayer compiles that rule once into all 81 ordered 3×3 board transitions. Player B inspects and explicitly accepts that immutable relation before deterministic play. The build passes only when unsupported/ambiguous compilation fails safely, every state mutation is actor/phase/revision guarded, all terminal outcomes are reproducible, the frontend preserves wallet and transaction truth, and live deployment later proves FINALIZED plus semantic success plus authoritative readback.

## Exact artifact allowlist and hashes

- `contracts/main.py`: `D9396C48742DB961C4CDE142252B03A09612EF248AF4A111C900128D34501B62`
- `contract-schema.json`: `54DC70986664B18F60BF696EE3E641397939872C5882F66BABD5657795CAA839`
- `STAGE-1.md`: `F3E2CA69C9DF93E45D1308DA2B6FCDC802E6DABF635E2873795C097030D310D4`
- `STAGE-2.md`: `65B2BC85DF7A456967CFE073EB35FD77328234A7258A029C8B8D8A1F49598D15`
- `docs/FRONTEND-DESIGN-RATIONALE.md`: `CA2562524F7F39B8791789750F6DEB08C13C55F3289D8D8DFDC4E4542C721483`
- `docs/FUNCTIONAL-FRONTEND-EVIDENCE.md`: `3CC27F661D6D216C079C0919D8D5AD7E301E08069998BD137CEE61DCB2C2B918`
- `docs/RPC-BUDGET.md`: `9DD276A8D3BDA7E0D79F798F076000BB6C5B419165D79957CDEC4202F9BB5080`
- `docs/STUDIO-E2E-PLAN.md`: `CAAF267C932EFDF42043528D232771023320564A4C3EB7AB07AB0A4A694E456B`
- `frontend/package-lock.json`: `BD1ED4830E4E412021BFF9DA0DE4C1B314493F108E761198A69C3AE27B8343D9`

Reviewer should inspect all committed files at the exact revision; this list identifies the package anchors and does not hide implementation dependencies.

## Contract/runtime inventory

- One deployable class: `CompiledBoardMoveArena(gl.Contract)`; no constructor args.
- Storage: `case_count: u256`; `cases`, `nonce_index`, `actor_index`, `child_index`, `version_index`, and `history` are fully-instantiated `TreeMap` values with JSON-safe string boundaries.
- Public interface: 8 writes (`create_arena`, `freeze_rule`, `compile_moves`, `retry_compile`, `join_arena`, `move_piece`, `resign_arena`, `cancel_arena`) and 7 views (`get_case`, `get_version`, `get_id_by_nonce`, `get_count`, `list_cases`, `list_actor`, `list_children`).
- Nondeterminism: one `gl.nondet.exec_prompt` inside `gl.vm.run_nondet_unsafe`; validator independently reruns the same bounded compile and requires exact canonical `{v,supported,cells}` equality. Malformed, oversized, unsupported, and disagreement paths fail closed. No storage proxy enters the nondeterministic closure.
- Linked/value boundaries: no linked contract, EVM message, custody, token, payment, or value transfer.
- Time: UTC epoch is used only to enforce retry cooldown after accepted compilation attempts; it does not decide matrix cells or game outcomes.
- Classification: `INTENTIONALLY FROZEN`. There is no admin/upgrader/owner path. Recovery from a Studionet reset or inaccessible deployment is a newly reviewed replacement deployment; no upgradeability claim is made.

## Tool/runtime and exact checks

- Retrieval/check date: 2026-09-07.
- Python `3.13.6`; `genvm-lint 0.11.0`; Node `v22.22.2`; npm `12.0.2`.
- Pinned feasibility runner remains the tested compatible runner documented in `docs/FEASIBILITY.md`; the advertised newer runner was rejected after schema/direct-runtime failure and is not silently substituted.
- `$env:PYTHONUTF8='1'; genvm-lint check contracts/main.py`: PASS, 3 lint checks, validation PASS, 15 methods (7 view, 8 write).
- `python -m pytest -q`: PASS, 12 tests.
- `npm test -- --run`: PASS, 8 files and 63 tests.
- `npm run build`: PASS; only the reviewed non-blocking Vite chunk-size advisory remains.
- `npm run test:e2e`: PASS, 3 Playwright tests.
- `git diff --check`: PASS.

Coverage includes constructor/default state, create idempotency/conflict, bounds, authorization, phase and revision CAS, compile success/unsupported/ambiguous/malformed/disagreement, retry cooldown/exhaustion, join consent, legal/illegal move, capture, no-move, draw, resignation, cancellation, historical versions, pagination, serialization-shaped canonical JSON, wallet provider cardinality/binding/events, bounded RPC/backoff, durable hash reconciliation, transaction progress, and mobile public workflow.

## Locked Studio preparation

- Network: Studionet `61999`.
- Selected accessible account: `0xeF5D2119416A2f5afa35dCFA209766EFC1BE5902`, observed selected with `998 GEN`; role is deployer only.
- No signature, deployment transaction, contract write, or Studio E2E has occurred.
- A read-only account-picker inspection occurred before the capability probe and showed a pre-existing `30 requests per minute` notice. This sequencing deviation is disclosed; no retry or transaction followed. The completed matrix and `OBSERVABLE_ACTION_LEDGER` mode are locked before deployment/E2E.
- Exact minimum-sufficient live plan: `docs/STUDIO-E2E-PLAN.md`.
- Separate Studio and frontend budgets: `docs/RPC-BUDGET.md`.

## Changed evidence and limits

- Since functional revision `60e1fddb1ffc01b39b393f32d88d072423d8c306`, `a39a1c1` strengthened transaction pre-state verification and `10be629` added the bounded judge-facing frontend redesign. Contract source and ABI are unchanged.
- Claude output was manually transferred and independently checked; it is not approval evidence.
- Current evidence is pre-deployment only. Contract address, deployment hash, live Studio transactions/readbacks, repository URL, Vercel URL, and final usage evidence do not yet exist and are not requirements of PRE_DEPLOY.
- Studio rate limits and nondeterministic validator agreement are live risks handled by bounded polling, cooldown, preserved hashes and fail-closed stopping.

PRIMARY_AI_VERDICT: APPROVED - PRE_DEPLOY readiness for revision `10be6291350c84bf0aa8c64a2be2fb29e3f0d426`, subject to independent anonymous review of this exact committed package. This does not claim deployment or live E2E success.
