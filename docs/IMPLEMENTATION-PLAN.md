# Compiled Board Move Arena — Implementation Plan

## Locked product boundary

Implement the approved C11 Research handoff without changing its trust problem, actors, public methods, phases, state transitions, 81-cell compilation result, deterministic gameplay, acceptance criteria, or single-contract/no-backend scope.

## Architecture

- `contracts/main.py`: one GenLayer contract; canonical JSON records in bounded `TreeMap` storage; one custom compile consensus path; all play methods deterministic.
- `tests/test_contract.py`: deterministic reducer, authority/CAS/no-write, serialization, custom-validator, and zero-nondeterminism-during-play coverage.
- `frontend/`: React/Vite client using one GenLayer client, canonical wallet-session store, durable operation journal, bounded RPC lifecycle, and authoritative historical readback.
- No server, database, token, payment, external fetch, upgrade mechanism, or generated code execution.

## Pre-lock feasibility

Probe the current official header/dependency, contract discovery, `u256`/`Address` ABI, seven `TreeMap` declarations, custom `run_nondet_unsafe` leader/validator with primitive captures and pickling checks, lint, schema extraction, and focused Direct Mode behavior. Probe evidence is not deployment evidence.

## Experience application

- Independently rederive consequential consensus fields: validator recompiles the same frozen rule and exact 81 cells; schema-valid false leader output must be rejected.
- Keep test doubles narrower than runtime: use production-shaped addresses and storage behavior; enable pickling/serialization checks.
- Compare only consequence-authorizing consensus fields: exact `{v,supported,cells}` is appropriate because every cell controls legality.
- Keep specification/result schema identical across contract, frontend parser, tests, and readback.
- Verify the current Studio text-runner header before PRE_DEPLOY; do not assume the historical `# v0.1.0` line is current.

## Verification sequence

1. Current-runtime feasibility probe: lint, schema, Direct Mode/pickling.
2. Contract implementation and focused/full tests.
3. Frontend RPC matrix, wallet/journal implementation, unit/build/Playwright tests.
4. Functional frontend and evidence package.
5. Anonymous PRE_DEPLOY review; only then Studio deploy/E2E.
6. POST_DEPLOY_TEST review, locked public GitHub/Vercel targets, approved hosted E2E permission, final reviews, Explorer package.

## Mechanical records

- 2026-09-07: Added canonical project pointer files, ignore rules, and this plan. No Stage 1/2 behavior changed.
