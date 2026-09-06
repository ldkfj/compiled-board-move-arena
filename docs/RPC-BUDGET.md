# RPC Budgets

## FRONTEND RPC BUDGET MATRIX

FRONTEND_MATRIX_STATUS: READY

| Screen/workflow | Request source | RPC method | Trigger | Cache key / TTL | In-flight dedupe | Invalidation | Poll interval / attempts | Retry/backoff/cancel | Planned maximum | Transaction count | Terminal/readback condition |
|---|---|---|---|---|---|---|---|---|---:|---:|---|
| Landing and wallet picker | React and EIP-6963 registry | None | Load or picker open | None | N/A | N/A | None | No retry | 0 | 0 | No account request before explicit provider choice |
| Connect wallet | Selected detected EIP-1193 provider | eth_requestAccounts, eth_accounts, eth_chainId, conditional chain switch/add | Explicit wallet choice | Session only | One active connect | Account or chain event | None | Surface error; no automatic reconnect | 7 | 0 | Selected provider, account, and Studionet chain agree |
| Arena list or detail | Shared GenLayer read client | get_count/list_cases/get_case/get_version | Explicit navigation or refresh | Method and args, in-flight only | Same key shares one promise | Before authoritative post-write readback | None | No background retry | 1 | 0 | Exact schema-valid record or explicit error |
| Create arena | Wallet write client and shared read client | write plus status and get_id_by_nonce/get_version | One explicit submit | No stale cache | Journal lock and operation fingerprint | Before readback | 2/4/8 seconds, maximum 3 | Stop and preserve hash; never resubmit | 6 | 1 | FINALIZED plus FINISHED_WITH_RETURN plus version 1 readback |
| Arena write | Wallet write client and shared read client | write plus status and get_version | One explicit action | No stale cache | One unresolved case operation | Before readback | 2/4/8 seconds, maximum 3 | Stop and preserve hash; never resubmit | 5 | 1 | Finality plus semantic execution plus exact next history revision |
| Resume or reconcile | Shared read client | same-hash status and get_version | One explicit journal action | No cache | Global lifecycle gate | Before readback | One status attempt | No submission or replacement | 2 | 0 | Verified/error only after authoritative readback; otherwise RECONCILE |

Landing, hidden tabs, account changes, and route renders perform zero polling. Journal load/export is browser-storage only. Each unresolved hash is immutable and only that hash may be reconciled.

## STUDIO RPC MEASUREMENT CAPABILITY PROBE

STUDIO_CAPABILITY_PROBE_STATUS: COMPLETE
STUDIO_MEASUREMENT_MODE: OBSERVABLE_ACTION_LEDGER
STUDIO_MEASUREMENT_TIMING: PRE_DEPLOY_AND_PRE_E2E
STUDIO_CAPABILITY_PROBE_AT: 2026-09-07T04:25:00+07:00
STUDIO_CAPABILITY_TOOL_OR_API: Codex in-app Browser accessibility tree, DOM/screenshot observation, Studio logs, and visible transaction/lifecycle panels
STUDIO_CAPABILITY_CHECK: The available browser surface was inspected for request-event, performance-request, proxy-log, or equivalent physical-network telemetry. It exposes observable UI actions and resulting Studio transaction/lifecycle/readback state, but no reliable per-request physical network counter.
STUDIO_CAPABILITY_RESULT: Physical network requests are not reliably exposed; every primary-AI Studio action, transaction hash, visible status observation, terminal receipt inspection, authoritative contract readback, retry, and account switch is observable and will be ledgered.
STUDIO_PHYSICAL_COUNT_CLAIM: NONE
STUDIO_ACTION_LEDGER_STATUS: LOCKED_BEFORE_DEPLOYMENT_AND_E2E

Deviation disclosure: a read-only Studio account-picker inspection occurred immediately before this probe to identify the required deployer account. It produced no signature, deployment, contract write, or E2E action. The Studio UI displayed a pre-existing `30 requests per minute` rate-limit notice. No retry was made. This probe and matrix are locked before every transaction and before Studio E2E begins.

## STUDIO RPC BUDGET MATRIX

STUDIO_MATRIX_STATUS: READY
STUDIO_DEPLOYER_ACCOUNT: 0xeF5D2119416A2f5afa35dCFA209766EFC1BE5902
STUDIO_NETWORK: Studionet, chain 61999
STUDIO_DUPLICATE_TRANSACTION_POLICY: Never resubmit an uncertain operation; retain and reconcile the existing hash.

| Row | Workflow | Actor | Observable action/read | Trigger | Poll policy | Max explicit status observations | Max terminal receipt reads | Max authoritative readbacks | Planned transactions | Terminal condition |
|---|---|---|---|---|---|---:|---:|---:|---:|---|
| S0 | Identity/network precheck | deployer | Confirm selected address, balance, Studionet and source editor | Once before deploy | None | 0 | 0 | 0 | 0 | Exact account and chain displayed; no rate-limit blocker |
| S1 | Exact-source schema/source check | deployer | Load exact `contracts/main.py`, verify class/interface/source hash | Once | None | 0 | 0 | 0 | 0 | Studio source equals reviewed bytes |
| S2 | Deploy | deployer | Submit one deployment | Once after PRE_DEPLOY approval | Observe at bounded 3/6/12/20-second checkpoints; stop on terminal/rate limit | 4 | 1 | 2 | 1 | Valid hash, FINALIZED, semantic SUCCESS, sender/origin match, code/source and zero-state readback |
| S3 | Compile-consent-capture critical journey | A then B | create, freeze, compile, join, four orthogonal moves ending in capture | One fresh arena | Per transaction: bounded 3/6/12/20-second observations, stop on terminal | 32 | 8 | 16 | 8 | Every write FINALIZED + SUCCESS + exact next revision; outcome CAPTURE |
| S4 | Resignation terminal | A then B | create, freeze, compile, join, resign | One fresh arena | Same bounded policy | 20 | 5 | 10 | 5 | Outcome RESIGNED and winner read back |
| S5 | Cancellation terminal | A | create then cancel before consent | One fresh arena | Same bounded policy | 8 | 2 | 4 | 2 | Outcome CANCELLED read back |
| S6 | No-move terminal | A then B | Rule allowing only 0 to 1; create, freeze, compile, join, A moves 0 to 1 | One fresh arena | Same bounded policy | 20 | 5 | 10 | 5 | Outcome NO_MOVE and winner read back |
| S7 | Unsupported-rule terminal | A | Rule depending on outside/history facts; create, freeze, compile | One fresh arena | Same bounded policy | 12 | 3 | 6 | 3 | supported=false, phase DONE, outcome UNSUPPORTED_RULE |
| S8 | Unplayable-rule terminal | A | Rule denying every move; create, freeze, compile | One fresh arena | Same bounded policy | 12 | 3 | 6 | 3 | Complete matrix with no playable opening; outcome UNPLAYABLE_RULE |
| S9 | Draw terminal | A then B | Create/freeze/compile/join and 12 legal non-capturing plies | One fresh arena | Same bounded policy | 64 | 16 | 32 | 16 | Outcome DRAW at ply 12 |
| S10 | Unresolved/retry/exhausted conditional path | A | Use one bounded ambiguous coordinate rule; retry only when authoritative phase is UNRESOLVED and cooldown permits | One fresh arena; no repeated arena creation | Same bounded policy; stop on resolved terminal or EXHAUSTED | 20 | 5 | 10 | max 5 | Existing case transitions through retry revisions; no blind retry or duplicate create |
| S11 | Authorization/stale-CAS negative | wrong actor | One unauthorized or stale revision write against an existing test arena | One diagnostic transaction only | Same bounded policy | 4 | 1 | 2 | 1 | Finalized error is classified by unchanged/competing exact readback; no false success |

The matrix is deliberately exhaustive because CAPTURE, RESIGNED, CANCELLED, NO_MOVE, UNSUPPORTED_RULE, UNPLAYABLE_RULE, DRAW, and conditional retry/exhaustion are materially different advertised outcomes. Rows may reuse the same validated source and account identities, but never reuse a transaction as proof of a different consequence. If Studio rate limiting prevents bounded observation, stop, retain every existing hash and state, record cooldown, and resume without redeploying or resubmitting.
