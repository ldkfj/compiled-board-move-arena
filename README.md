# Compiled Board Move Arena

Compiled Board Move Arena is a two-player board game powered by a GenLayer contract. Player A submits a coordinate-only movement rule. The contract compiles that rule into an 81-cell movement matrix, Player B accepts the compiled result, and both players then play against the stored matrix.

## Public workflow

1. Open the app and connect a supported wallet on GenLayer Studio Dev (chain `61997`).
2. Create an arena with an opponent address and a movement rule.
3. Freeze the rule, compile the matrix, and inspect the result.
4. The opponent joins only after a playable matrix is available.
5. Players make legal moves until capture, resignation, no-move, draw, cancellation, or an unsupported rule ends the arena.

The contract validates actors, phases, revisions, turns, board coordinates, and matrix legality on-chain. The frontend waits for finality and authoritative readback before showing a completed action.

## Development

```powershell
cd frontend
npm install
npm test
npm run build
npm run test:e2e
```

Contract checks use the pinned Studio-compatible GenLayer toolchain:

```powershell
genvm-lint check contracts/main.py
python -m pytest -q
```

No backend or hosted service is required. Studio Dev writes require a funded wallet and are intentionally performed separately from the local test suite.
