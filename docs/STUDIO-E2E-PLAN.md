# Studio E2E Test Plan — PRE_DEPLOY

PLAN_STATUS: READY_FOR_ANONYMOUS_PRE_DEPLOY_REVIEW

## Binding

- Project: Compiled Board Move Arena
- Exact revision: `10be6291350c84bf0aa8c64a2be2fb29e3f0d426`
- Contract source: `contracts/main.py`
- Source SHA-256: `D9396C48742DB961C4CDE142252B03A09612EF248AF4A111C900128D34501B62`
- Network: GenLayer Studionet, chain `61999`
- Locked Studio deployer account: `0xeF5D2119416A2f5afa35dCFA209766EFC1BE5902`
- Contract classification: `INTENTIONALLY FROZEN`
- Constructor arguments: none
- Deployment count: exactly one unless a verified unrecoverable platform failure is reviewed separately.

## Initial conditions

1. Reopen one fresh in-app Studio tab only after anonymous `PRE_DEPLOY` approval.
2. Verify selected account, spendable balance, Studionet chain, exact source bytes/hash, one discoverable contract, and 15-method interface.
3. Verify no pending deployment/write hash exists for this Task.
4. Begin the locked `OBSERVABLE_ACTION_LEDGER`; make no physical-request-count claim.
5. If the observed rate-limit notice persists, stop for cooldown without signing or retrying.

## Ordered execution

1. Deploy the exact reviewed source once from the locked account.
2. Capture deployment hash, sender/origin, bounded status observations, terminal receipt, semantic execution result, contract address, deployed code/source parity, `get_count == 0`, and absent case readback.
3. Execute rows `S3` through `S11` from `docs/RPC-BUDGET.md` in order, reusing actor accounts but using fresh case IDs only where a materially different terminal path requires independent state.
4. For every write, record method, actor, arguments, pre-revision/pre-state hash, transaction hash, status observations, terminal receipt, semantic result, consensus/finality, expected post-revision, `get_version`, and `get_case` result before the next write.
5. Switch between Studio accounts only at explicit actor boundaries. Confirm the displayed address before each actor-dependent write.
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

Produce `docs/VERIFICATION.md` and append `STUDIO RPC BUDGET EVIDENCE` with one reusable proof row per deployment/write path: requirement and actor → Studio action → method → hash → FINALIZED → semantic result → consensus/finality → exact readback → source/test reference. Record actual observable actions, polls, receipt reads, readbacks, retries, duplicate transactions and matrix variance. Do not invent unavailable physical request counts.

No Studio signature, deployment, write, or E2E action is authorized until the exact PRE_DEPLOY package receives the required anonymous approval.
