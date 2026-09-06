# Frontend Design Rationale

## Product identity

Compiled Board Move Arena is not a generic game dashboard. Its visual idea is a small, public rules laboratory: prose enters on the left, a finite transition kernel becomes inspectable, and a compact 3×3 arena executes only what both players saw before consent.

## Information hierarchy

1. Explain the invariant: the movement interpretation cannot change mid-game.
2. Keep Create and Inspect as the two primary entry points.
3. Make phase, revision, ply, actor position, and legal moves visible around the board.
4. Treat the 9×9 transition matrix as first-class evidence, not developer debug output.
5. Keep transaction state and recovery visible without competing with play.
6. Explain Compile → Inspect → Consent → Deterministic Play in public documentation.

## Visual direction

Use a project-specific cartographic/technical-board language: coordinate marks, path lines, matrix cells, rule cards, and two clearly differentiated player tokens. Favor an editorial game-table composition over a SaaS dashboard or template card grid. Dark ink/navy with one luminous mint signal is an acceptable starting point, but Claude owns the final palette, typography, mark, spacing, motion, and responsive composition.

## Required state coverage

The presentation must handle disconnected, wallet chooser empty/one/multiple providers, connecting/error/connected/wrong-network; RULE_DRAFT, FROZEN, UNRESOLVED, EXHAUSTED, COMPILED, PLAYING, and DONE; COMPILED/UNSUPPORTED_RULE/UNPLAYABLE_RULE/CAPTURE/DRAW/NO_MOVE/RESIGNED/CANCELLED; player A/B/nonparticipant; own/opponent turn; signing through verified/failure/reconciliation; empty and populated journal; desktop/mobile/reduced motion.

## Non-negotiable integration boundary

Presentation consumes the existing wallet store, contract adapter, operation journal, RPC guard, and write coordinator. It must not create local connection truth, synthesize undetected wallets, poll in render effects, submit duplicate writes, clear an unresolved hash, or claim success before finality + semantic execution + exact historical readback.
