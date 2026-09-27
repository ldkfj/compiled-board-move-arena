# Studio Dev E2E Operation Plan — PRE_DEPLOY

PLAN_STATUS: READY_FOR_EXACT_REVISION_BINDING

## Binding

- Project: Compiled Board Move Arena
- Exact revision: pending the governed Git identity decision and commit
- Contract source: `contracts/main.py`
- Source SHA-256: generated after the exact revision is committed
- Network: GenLayer Studio Devnet, chain `61997`
- RPC: `https://studio-dev.genlayer.com/api`
- Explorer: `https://explorer-studio-dev.genlayer.com/`
- Prepared actor: `actor7` / `0x8581C4A532DD3f9B163b12809B1bD089f367147f`
- Contract classification: `INTENTIONALLY FROZEN`
- Constructor arguments: none
- Deployment count: exactly one unless a verified unrecoverable platform failure is reviewed separately.

## Initial conditions

1. Start only after anonymous `PRE_DEPLOY` approval of the exact committed revision.
2. Use the guarded official CLI wrapper and verify actor, spendable balance, Studio Dev chain, exact source bytes/hash, one discoverable contract, and 15-method interface.
3. Verify no pending deployment/write hash exists for this Task.
4. Assign one immutable operation ID to each deploy/write and retain its journal and log.
5. Obtain a fee estimate and preserve the returned fee profile, distribution, and `feeValue` unchanged before each fee-bearing write.

## Ordered execution

1. Deploy the exact reviewed source once from the locked account.
2. Capture deployment hash, sender/origin, bounded status observations, terminal receipt, semantic execution result, contract address, deployed code/source parity, `get_count == 0`, and absent case readback.
3. Execute the critical journeys in order: capture, resignation, cancellation, no-move, unsupported, unplayable, draw, conditional unresolved/retry/exhausted, then authorization/stale-CAS negative.
4. For every write, record method, actor, arguments, pre-revision/pre-state hash, transaction hash, status observations, terminal receipt, semantic result, consensus/finality, expected post-revision, `get_version`, and `get_case` result before the next write.
5. Switch actors only at explicit actor boundaries and confirm the public address before each actor-dependent write.
6. For `S10`, submit retry only if the same case authoritatively enters `UNRESOLVED`; honor the on-chain cooldown. If the first compile resolves to another valid terminal state, record that observed result and do not fabricate or blindly repeat a retry.
7. For `S11`, preserve the failed hash and prove unchanged or competing state from historical/current readback. Never count finalized error as success.
8. Stop immediately on unknown state, rate limit, missing hash, account mismatch, source mismatch, non-success receipt where success is expected, or readback disagreement. Preserve the current tab/hash/ledger and diagnose before any further transaction.

## Expected invariants

- Rule/base and response locks are true before compilation consequences.
- Player B cannot join before a complete playable matrix exists and joins the exact compiled revision.
- Move legality comes only from the stored 81-cell matrix; actor, turn, origin, ply, and revision checks remain enforced.
- Each successful mutation increments the exact historical revision and records method/caller/args hash.
- Idempotent create uses the same creator+nonce only; uncertain operations are reconciled, never replaced.
- Public views return canonical, schema-valid JSON and preserve prior versions.
- No owner, upgrader, custody, token transfer, linked contract, external web source, or runtime model call after compilation exists.

## Evidence output

Produce `docs/VERIFICATION.md` with one proof row per deployment/write path: operation ID and actor → fee estimate/profile → method and arguments → hash → FINALIZED → semantic result → consensus/finality → exact readback → source/test reference. Record retries and duplicates as zero unless actually observed; never invent unavailable evidence.

No Studio signature, deployment, write, or E2E action is authorized until the exact PRE_DEPLOY package receives the required anonymous approval.
