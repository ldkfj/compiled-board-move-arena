# PRE_DEPLOY Review Package Draft

PACKAGE_STATUS: READY_FOR_GIT_IDENTITY_AND_EXACT_REVISION_BINDING
CHECKPOINT: PRE_DEPLOY
REVISION: pending governed commit

## Product and acceptance boundary

Player A freezes one bounded public coordinate rule. GenLayer compiles it once into all 81 ordered 3×3 board transitions. Player B inspects and explicitly accepts that immutable relation before deterministic play. Unsupported or ambiguous compilation fails safely; every mutation is actor/phase/revision guarded; live success later requires FINALIZED, semantic success, and authoritative historical/current readback.

## Worktree artifact anchors

- `contracts/main.py`: `EDA9EF5D7FAF61E3DEAABF545AE8198313DDCE5272DAF76405E078E93281C8C9`
- `contract-schema.json`: `54DC70986664B18F60BF696EE3E641397939872C5882F66BABD5657795CAA839`
- `STAGE-1.md`: `F3E2CA69C9DF93E45D1308DA2B6FCDC802E6DABF635E2873795C097030D310D4`
- `STAGE-2.md`: `B3B495318632A0F6E907D85CC076729DE6B7B1AD4B4FCCB4946335638FFDD748`
- `docs/FRONTEND-DESIGN-RATIONALE.md`: `CA2562524F7F39B8791789750F6DEB08C13C55F3289D8D8DFDC4E4542C721483`
- `docs/FUNCTIONAL-FRONTEND-EVIDENCE.md`: `3CC27F661D6D216C079C0919D8D5AD7E301E08069998BD137CEE61DCB2C2B918`
- `docs/RPC-BUDGET.md`: `BE01C03F600A2651A2B7062F626A884486FEB1DFAAA728BA8C4D7A7727D2FA92`
- `docs/STUDIO-E2E-PLAN.md`: `2C1C3B8D7450D7A4F0F43966D66D4DE3E0DA777E6861713EEC5B7143A0F054DC`
- `docs/STUDIO-TOOL-READINESS.json`: `DFB034123837FEFC21D4A106214F3703E11A98B047B6E4A6D1269CA0C4907261`
- `frontend/package-lock.json`: `CCCF0322CB611F1A9D1C647E84FE49D811010B344957F681093D3D3B36439305`

These are pre-commit worktree hashes. The exact-revision package and anonymous-review prompt must be regenerated after the governed Git identity is selected and the commit exists.

## Contract/runtime inventory

- One deployable `CompiledBoardMoveArena(gl.contract.Contract)`; no constructor arguments.
- Storage uses `gl.u256` and six fully-instantiated `gl.storage.TreeMap` values with canonical JSON boundaries.
- Public interface: 8 writes and 7 views.
- One `gl.nondet.exec_prompt` inside safer custom `gl.vm.run_nondet`; the validator reruns the bounded compile and requires exact canonical `{v,supported,cells}` equality.
- Prompt text explicitly delimits the rule as untrusted data and rejects instructions inside it.
- No linked contract, custody, token, payment, value transfer, owner, upgrader, or post-compilation model call.
- Classification: `INTENTIONALLY FROZEN`.

## Runtime and checks

- Contract API `v0.3.0`; runner `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` from GenVM Manager `v0.6.0-rc5`.
- `genvm-lint 0.11.1rc2`: PASS, 3 checks; schema validation PASS, 15 methods.
- `genlayer-test 0.30.0rc2` Direct Mode under WSL: 12 PASS.
- `genlayer-js 2.0.0-rc.1`; frontend unit: 63 PASS; build: PASS; Playwright: 3 PASS.
- `git diff --check`: PASS after final verification.

## Studio tool readiness

- Target: Studio Dev preset `studio-dev`, chain `61997`, RPC `https://studio-dev.genlayer.com/api`.
- Prepared actor: `actor7`, address `0x8581C4A532DD3f9B163b12809B1bD089f367147f`; observed balance `139982851014249816495` wei.
- Official guarded CLI wrapper supports isolated actor profiles, immutable operation IDs/journals, receipt reconciliation, fee estimation, and authoritative readback.
- `writesSubmitted = 0`; no deployment or contract write has occurred for this project.
- Current governance defines no Studio RPC-count budget. Frontend RPC limits remain tested and binding.

## Remaining gate

Select the Git account that must own all AI commits and later pushes for this project. Then commit, recompute exact hashes and revision, run the final consistency scan, and issue one self-contained anonymous PRE_DEPLOY review prompt. No Studio signature, fee-bearing action, deployment, or write is authorized before anonymous approval.

PRIMARY_AI_VERDICT: Worktree implementation is ready for Git identity binding. This draft is not anonymous approval and does not claim deployment or live E2E success.
