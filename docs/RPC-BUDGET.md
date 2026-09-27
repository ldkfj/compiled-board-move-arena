# RPC Budgets

## FRONTEND RPC BUDGET MATRIX

FRONTEND_MATRIX_STATUS: READY

| Screen/workflow | Request source | RPC method | Trigger | Cache key / TTL | In-flight dedupe | Invalidation | Poll interval / attempts | Retry/backoff/cancel | Planned maximum | Transaction count | Terminal/readback condition |
|---|---|---|---|---|---|---|---|---|---:|---:|---|
| Landing and wallet picker | React and EIP-6963 registry | None | Load or picker open | None | N/A | N/A | None | No retry | 0 | 0 | No account request before explicit provider choice |
| Connect wallet | Selected detected EIP-1193 provider | eth_requestAccounts, eth_accounts, eth_chainId, conditional chain switch/add | Explicit wallet choice | Session only | One active connect | Account or chain event | None | Surface error; no automatic reconnect | 7 | 0 | Selected provider, account, and Studio Dev chain agree |
| Arena list or detail | Shared GenLayer read client | get_count/list_cases/get_case/get_version | Explicit navigation or refresh | Method and args, in-flight only | Same key shares one promise | Before authoritative post-write readback | None | No background retry | 1 | 0 | Exact schema-valid record or explicit error |
| Create arena | Wallet write client and shared read client | write plus status and get_id_by_nonce/get_version | One explicit submit | No stale cache | Journal lock and operation fingerprint | Before readback | 2/4/8 seconds, maximum 3 | Stop and preserve hash; never resubmit | 6 | 1 | FINALIZED plus FINISHED_WITH_RETURN plus version 1 readback |
| Arena write | Wallet write client and shared read client | write plus status and get_version | One explicit action | No stale cache | One unresolved case operation | Before readback | 2/4/8 seconds, maximum 3 | Stop and preserve hash; never resubmit | 5 | 1 | Finality plus semantic execution plus exact next history revision |
| Resume or reconcile | Shared read client | same-hash status and get_version | One explicit journal action | No cache | Global lifecycle gate | Before readback | One status attempt | No submission or replacement | 2 | 0 | Verified/error only after authoritative readback; otherwise RECONCILE |

Landing, hidden tabs, account changes, and route renders perform zero polling. Journal load/export is browser-storage only. Each unresolved hash is immutable and only that hash may be reconciled.

Studio execution is governed by `docs/STUDIO-E2E-PLAN.md` and `docs/STUDIO-TOOL-READINESS.json`. Current governance does not define a Studio RPC-count budget. Every write still uses one operation ID, bounded receipt reconciliation, semantic execution checks, and authoritative readback; uncertain writes are never resubmitted.
