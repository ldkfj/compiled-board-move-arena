# Compiled Board Move Arena — Stage 1

Research category: PROJECT
Canonical approval package: E:/Genlayer-Projects/_research-candidates-2026-09-01/CANONICAL-13-RESEARCH-R12.md
Approved package SHA-256: 3464E830908CB1D87504057567242D36BDCD0C4FD59934B7D22F6482C6799ED2
Candidate: C11
Anonymous research verdict: APPROVED

## C11 — Compiled Board Move Arena

### Stage 1 / CANDIDATE QUALITY RECORD

A two-player native board game starts from a public natural-language movement rule. An operator must not reinterpret the rule opportunistically during play. GenLayer independently compiles the frozen rule into the COMPLETE finite move relation before the opponent joins. Both players inspect the same immutable matrix; all subsequent turns/capture/draw calculations are deterministic. Ordinary code alone requires a programmer to translate every custom rule; an LLM game server can change translation mid-game. The product fixes the interpreter output BEFORE consent/play, rather than scoring individual moves semantically.

Actors A writes/freezes one rule; any caller compiles; B accepts the published compiled matrix by join; A/B alternate native moves. No assertion about a physical game or real achievement. Board and actions exist solely in the contract. One contract, no fetch/backend/randomness/stakes. Three-by-three cells, max12moves. GenLayer essential only at compile; deterministic execution thereafter is a deliberate cost/risk reduction.

Closest C10 is a two-player semantic game, but each word move is judged dynamically, with category/word-chain/points. C11 turns prose into an executable finite transition kernel, then has zero semantic calls during play and deterministic capture. Closest repository ai-nft-studio-genlayer uses rubric judgment then mint; not a compiled board relation with alternating native execution. Possible overlap with generic gaming templates remains an originality risk; new mechanism is immutable compile-then-consent-then-execute, not name/theme. KEEP for review.

Evidence: full81cell relation, source rule, join revision, move list/current positions, deterministic replay. Easy board UI9buttons; hard ambiguous prose translation. Compiler refuses history-dependent/external rules as UNSUPPORTED. Unknown/disagreement never produces a playable arena. Simplest fallback cancel and create a clearer rule, not hidden programmer patching of the matrix.

