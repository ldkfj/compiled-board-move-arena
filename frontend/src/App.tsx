import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { browserDiscoveryHost } from "./wallet/providers";
import { createWalletStore, emptyWalletSessionState } from "./wallet/store";
import { createBrowserJournal, type JournalRecord } from "./pending";
import { executeWrite, reconcileWrite, INITIAL_WRITE_PROGRESS, type WriteProgress } from "./chain/writeCoordinator";
import {
  canonicalJson,
  chainIdDecimal,
  invalidateReadRequests,
  makeWriteAdapter,
  normalizeAddress,
  parseRecord,
  pollFinalized,
  randomHex,
  readCase,
  readIdByNonce,
  readVersion,
  requireContractAddress,
  sha256Hex,
  validateContractText,
  ZERO_HASH,
  type CaseRead,
  type WriteMethod,
} from "./contract";
import { TransactionProgress } from "./components/TransactionProgress";

const walletStore = typeof window === "undefined" ? null : createWalletStore(browserDiscoveryHost(), makeWriteAdapter);
const journal = typeof window === "undefined" ? null : createBrowserJournal();

function short(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}
function nextRevision(value: string) {
  return (BigInt(value) + 1n).toString();
}
function phaseLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function journalStatusLabel(record: JournalRecord): string {
  let classification = "";
  try {
    classification = String((JSON.parse(record.resolution_json) as { classification?: unknown }).classification ?? "");
  } catch {
    classification = "";
  }
  if (record.status === "FINALIZED_ERROR" && classification === "PRESENT") return "Finalized; expected state present";
  if (record.status === "FINALIZED_ERROR" && classification === "UNCHANGED") return "Finalized; state unchanged";
  if (record.status === "FINALIZED_ERROR" && classification === "COMPETING") return "Finalized; competing operation retained";
  return phaseLabel(record.status);
}

const RULE_PRESETS = [
  { label: "Orthogonal only", rule: "Move one square orthogonally; no diagonal moves." },
  { label: "King (All 8 dirs)", rule: "Move one square in any direction, orthogonally or diagonally." },
  { label: "Knight jumps", rule: "Move in an L-shape: two squares along one axis and one square perpendicularly." },
  { label: "Forward only", rule: "Move one square towards the opponent side; backward moves are prohibited." },
];

function cellCoord(cell: number): string {
  return `(${Math.floor(cell / 3)}, ${cell % 3})`;
}

export default function App() {
  const wallet = useSyncExternalStore(
    walletStore?.subscribeWalletState ?? (() => () => {}),
    walletStore?.getWalletState ?? emptyWalletSessionState,
    walletStore?.getWalletState ?? emptyWalletSessionState,
  );
  const view = walletStore?.selectWalletView() ?? {
    connected: false,
    chooserOpen: false,
    providerOptions: [],
    badge: "Disconnected",
    primaryAction: "Connect wallet",
    canWrite: false,
    error: "",
  };
  const [arena, setArena] = useState<CaseRead | null>(null);
  const [caseId, setCaseId] = useState("1");
  const [opponent, setOpponent] = useState("");
  const [rule, setRule] = useState("Move one square orthogonally; no diagonal moves.");
  const [progress, setProgress] = useState<WriteProgress>(INITIAL_WRITE_PROGRESS);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState<JournalRecord[]>([]);
  const contract = useMemo(() => {
    try {
      return requireContractAddress();
    } catch {
      return "";
    }
  }, []);

  useEffect(() => {
    void journal?.list().then(setAttempts).catch(() => setAttempts([]));
    return () => walletStore?.destroy();
  }, []);

  useEffect(() => {
    if (!view.chooserOpen) return;
    document.querySelector<HTMLElement>(".wallet-dialog button")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") walletStore?.closeWalletPicker();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [view.chooserOpen]);

  async function load(id = caseId) {
    try {
      const value = await readCase(id);
      setArena(value);
      setCaseId(id);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function write(method: WriteMethod, args: unknown[], intent: string, preRevision: string, nonce?: string) {
    if (!wallet.writeClient || !wallet.account || !journal || !contract) {
      setNotice("Connect a detected wallet and configure VITE_CONTRACT_ADDRESS.");
      return;
    }
    setBusy(true);
    setProgress(INITIAL_WRITE_PROGRESS);
    setNotice("");
    try {
      const argsJson = canonicalJson(args);
      const argsHash = await sha256Hex(argsJson);
      const preHash = arena ? await sha256Hex(arena.raw) : ZERO_HASH;
      let resolvedId = arena?.record.id ?? "0";
      const outcome = await executeWrite(
        {
          journal: {
            chain: chainIdDecimal(),
            contract,
            account: wallet.account,
            method,
            intent,
            argsJson,
            preRevision,
            preHash,
            preStateJson: arena?.raw ?? "",
          },
          submit: () => wallet.writeClient!.submit(method, args as never[]),
          pollFinalized: wallet.writeClient.pollFinalized,
          verifyPre: async (signal) => {
            if (nonce) return (await readIdByNonce(wallet.account!, nonce, contract, signal)) === "0";
            if (resolvedId === "0") return false;
            const raw = await readVersion(resolvedId, preRevision, contract, signal);
            return raw ? (await sha256Hex(raw)) === preHash : false;
          },
          verifyPost: async (signal) => {
            invalidateReadRequests();
            if (nonce) resolvedId = await readIdByNonce(wallet.account!, nonce, contract, signal);
            const revision = nonce ? "1" : nextRevision(preRevision);
            const raw = await readVersion(resolvedId, revision, contract, signal);
            const record = raw ? parseRecord(raw) : null;
            if (
              !record ||
              record.last_operation.method !== method ||
              record.last_operation.caller !== wallet.account ||
              record.last_operation.args_hash !== argsHash
            ) {
              return false;
            }
            setArena({ raw: raw!, record });
            setCaseId(resolvedId);
            return true;
          },
          progress: setProgress,
        },
        { journal },
      );
      setAttempts(await journal.list());
      setNotice(
        outcome.status === "VERIFIED"
          ? "Verified by finalized execution and exact historical readback."
          : outcome.status === "CANCELLED"
            ? "Wallet request cancelled; no transaction sent."
            : "Reconciliation required. The existing attempt is preserved; do not resubmit.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const nonce = randomHex(16);
      const target = normalizeAddress(opponent);
      const frozenRule = validateContractText(rule, 512);
      await write("create_arena", [nonce, target, frozenRule], `create:${wallet.account}:${nonce}`, "0", nonce);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function action(method: WriteMethod, extras: unknown[] = []) {
    if (!arena) return;
    const args = [arena.record.id, ...extras, arena.record.revision];
    void write(
      method,
      args,
      `${method}:${arena.record.id}:${arena.record.revision}${method === "move_piece" ? `:${arena.record.domain.ply}` : ""}`,
      arena.record.revision,
    );
  }

  async function reconcile(item: JournalRecord) {
    if (!journal || busy || !contract) return;
    setBusy(true);
    setProgress(INITIAL_WRITE_PROGRESS);
    try {
      const args = JSON.parse(item.args_json) as unknown[];
      const argsHash = await sha256Hex(item.args_json);
      let id = item.pre_revision === "0" ? await readIdByNonce(item.account, String(args[0]), contract) : String(args[0]);
      const revision = item.pre_revision === "0" ? "1" : nextRevision(item.pre_revision);
      const outcome = await reconcileWrite(
        {
          journal: item,
          pollFinalized,
          verifyPre: async (signal) => {
            if (item.pre_revision === "0") return (await readIdByNonce(item.account, String(args[0]), contract, signal)) === "0";
            const raw = await readVersion(id, item.pre_revision, contract, signal);
            return raw ? (await sha256Hex(raw)) === item.pre_hash : false;
          },
          verifyPost: async (signal) => {
            if (id === "0" && item.method === "create_arena") id = await readIdByNonce(item.account, String(args[0]), contract, signal);
            const raw = await readVersion(id, revision, contract, signal);
            const next = raw ? parseRecord(raw) : null;
            if (
              !next ||
              next.last_operation.method !== item.method ||
              next.last_operation.caller !== item.account ||
              next.last_operation.args_hash !== argsHash
            ) {
              return false;
            }
            setArena({ raw: raw!, record: next });
            setCaseId(id);
            return true;
          },
          progress: setProgress,
        },
        { journal },
      );
      setAttempts(await journal.list());
      setNotice(
        outcome.status === "VERIFIED"
          ? "Existing transaction verified by exact readback."
          : "Existing transaction remains preserved for reconciliation.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const record = arena?.record;
  const mine = wallet.account?.toLowerCase();
  const myTurn = record?.phase === "PLAYING" && mine === (record.domain.turn === 0 ? record.primary : record.secondary);
  const legal = record?.domain.matrix ?? "";

  const reconcileTarget = useMemo(() => {
    return attempts.find((a) => ["SIGNING", "SUBMITTED", "RECONCILE"].includes(a.status));
  }, [attempts]);

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="site-header__inner">
          <a className="brand" href="#top" aria-label="Compiled Board Move Arena home">
            <span className="brand__logo-box" aria-hidden="true">
              <img src="/brand/logo.svg" alt="" width="28" height="28" />
            </span>
            <div className="brand__text-group">
              <span className="brand__name">Compiled Board Move Arena</span>
              <span className="brand__sub">GenLayer Intelligent Rules Instrument</span>
            </div>
          </a>

          <nav className="site-nav" aria-label="Primary navigation">
            <a href="#arena" className="site-nav__link">Arena</a>
            <a href="#how" className="site-nav__link">How it works</a>
            <a href="#journal" className="site-nav__link">Journal</a>
          </nav>

          <div className="site-header__actions">
            <div className="chain-badge" title="GenLayer Studio Dev Chain 61997">
              <span className="chain-badge__pulse" aria-hidden="true" />
              <span className="chain-badge__text">Studio Dev 61997</span>
            </div>
            <button
              type="button"
              className={`wallet-trigger ${view.connected ? "wallet-trigger--connected" : ""}`}
              onClick={() => walletStore?.openWalletPicker()}
              aria-haspopup="dialog"
            >
              <span className="wallet-trigger__dot" aria-hidden="true" />
              <span className="wallet-trigger__label">
                {view.badge === "Disconnected" ? "Connect wallet" : view.badge}
              </span>
            </button>
          </div>
        </div>
      </header>

      {view.chooserOpen && (
        <div className="wallet-modal-backdrop" onClick={() => walletStore?.closeWalletPicker()}>
          <section
            className="wallet-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Choose wallet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wallet-dialog__head">
              <div className="wallet-dialog__title-box">
                <span className="wallet-dialog__tag">EIP-6963 DISCOVERY</span>
                <h2>Choose a detected wallet</h2>
              </div>
              <button
                type="button"
                className="wallet-dialog__close-btn"
                onClick={() => walletStore?.closeWalletPicker()}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>
            <p className="wallet-dialog__intro">
              Connect an installed Web3 wallet to authorize arena creation, rule freezing, join consent, and deterministic moves on Studio Dev.
            </p>

            {view.providerOptions.length ? (
              <div className="wallet-dialog__options">
                {view.providerOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="wallet-provider-card"
                    onClick={() => void walletStore?.selectWallet(option)}
                  >
                    <div className="wallet-provider-card__main">
                      {option.info?.icon && (
                        <img src={option.info.icon} alt="" className="wallet-provider-card__icon" />
                      )}
                      <span className="wallet-provider-card__name">{option.name}</span>
                    </div>
                    <span className="wallet-provider-card__badge">
                      {option.source === "eip6963" ? "EIP-6963" : "Detected"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="wallet-dialog__empty-box">
                <span className="wallet-dialog__empty-glyph" aria-hidden="true">⚡</span>
                <p>No MetaMask, OKX Wallet, or Rabby provider detected.</p>
                <span className="wallet-dialog__empty-tip">
                  Ensure your wallet browser extension is active, then reload this page.
                </span>
              </div>
            )}

            <div className="wallet-dialog__foot">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => walletStore?.closeWalletPicker()}
              >
                Close
              </button>
            </div>
            {view.error && <p className="wallet-dialog__alert" role="alert">{view.error}</p>}
          </section>
        </div>
      )}

      <main className="main-content">
        <section className="hero" id="top">
          <div className="hero__editorial">
            <p className="eyebrow">COMPILE · CONSENT · PLAY</p>
            <h1>A movement rule that cannot change mid-game.</h1>
            <p className="hero__summary">
              GenLayer compiles one public rule into all 81 board transitions before the opponent joins. Every move after consent is deterministic and publicly replayable.
            </p>
            <div className="hero__ctas">
              <a className="cta" href="#arena">Open the arena</a>
              <a className="secondary-link" href="#how">How consensus compilation works →</a>
            </div>
          </div>

          <div className="hero__instrument" aria-hidden="true">
            <div className="instrument-panel">
              <div className="instrument-panel__header">
                <span className="instrument-panel__label">MECHANISM PIPELINE</span>
                <span className="instrument-panel__sublabel">Zero Runtime Model Calls</span>
              </div>
              <div className="pipeline-track">
                <div className="pipeline-node">
                  <span className="pipeline-node__idx">01</span>
                  <div className="pipeline-node__text">
                    <strong>Frozen Prose Rule</strong>
                    <span>Player A defines coordinate rule</span>
                  </div>
                </div>
                <div className="pipeline-connector">
                  <span className="pipeline-connector__line" />
                  <span className="pipeline-connector__badge">GenLayer Consensus</span>
                </div>
                <div className="pipeline-node pipeline-node--highlight">
                  <span className="pipeline-node__idx">02</span>
                  <div className="pipeline-node__text">
                    <strong>81-Cell Finite Matrix</strong>
                    <span>Complete 9×9 transition kernel</span>
                  </div>
                </div>
                <div className="pipeline-connector">
                  <span className="pipeline-connector__line" />
                  <span className="pipeline-connector__badge">Opponent Joins</span>
                </div>
                <div className="pipeline-node">
                  <span className="pipeline-node__idx">03</span>
                  <div className="pipeline-node__text">
                    <strong>Deterministic Arena</strong>
                    <span>Moves, capture & draw on-chain</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="arena" className="workspace">
          <form className="panel panel--create" onSubmit={create}>
            <div className="panel__title-bar">
              <span className="panel__tag">ACTOR A · INITIATOR</span>
              <h2>Create arena</h2>
              <p className="panel__lede">
                Freeze one natural-language movement rule on 3×3 coordinates and assign an opponent address.
              </p>
            </div>

            <div className="form-field">
              <label htmlFor="opponent-address-input">Opponent address</label>
              <input
                id="opponent-address-input"
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
                placeholder="0x…"
                required
                spellCheck={false}
                autoComplete="off"
                className="input-text input-text--mono"
              />
              <span className="form-hint">Distinct, non-zero Ethereum address for Player B.</span>
            </div>

            <div className="form-field">
              <label htmlFor="coordinate-rule-input">Coordinate movement rule</label>
              <textarea
                id="coordinate-rule-input"
                value={rule}
                onChange={(e) => setRule(e.target.value)}
                maxLength={512}
                required
                rows={3}
                spellCheck={false}
                className="textarea-mono"
              />
              <div className="rule-presets-strip" role="group" aria-label="Rule presets">
                <span className="rule-presets-strip__label">Presets:</span>
                {RULE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="rule-preset-chip"
                    onClick={() => setRule(preset.rule)}
                    disabled={busy}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <span className="form-hint">
                Governs square-to-square transitions on cells 0..8 independently of time or previous moves.
              </span>
            </div>

            <p className="warning">
              All submitted text is public and permanent. Do not include private information, credentials, or personal records.
            </p>

            <button
              type="submit"
              className="btn btn--primary btn--full"
              disabled={busy || !view.canWrite}
            >
              {busy ? "Submitting write…" : "Create arena"}
            </button>
            {!view.canWrite && (
              <p className="auth-required-hint">Connect a detected wallet to submit transactions.</p>
            )}
          </form>

          <section className="panel panel--inspect">
            <div className="panel__title-bar">
              <span className="panel__tag">ACTORS A & B · OBSERVERS</span>
              <h2>Inspect arena</h2>
              <p className="panel__lede">
                Inspect the frozen rule, compiled 9×9 transition matrix, player positions, and full move history.
              </p>
            </div>

            <div className="inline inspect-controls">
              <div className="id-input-group">
                <span className="id-input-group__prefix">Arena ID</span>
                <input
                  aria-label="Arena ID"
                  value={caseId}
                  onChange={(e) => setCaseId(e.target.value)}
                  type="text"
                  inputMode="numeric"
                  className="input-text input-text--mono"
                />
              </div>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => void load()}
                disabled={busy}
              >
                {busy ? "Loading…" : "Load"}
              </button>
            </div>

            {record ? (
              <div className="arena-workbench">
                <div className="status-banner">
                  <div className="status-banner__left">
                    <span className={`phase-tag phase-tag--${record.phase.toLowerCase()}`}>
                      <span className="phase-tag__bullet" aria-hidden="true" />
                      {phaseLabel(record.phase)}
                    </span>
                    {record.phase === "PLAYING" && (
                      <span className={`turn-tag ${myTurn ? "turn-tag--active" : "turn-tag--waiting"}`}>
                        {myTurn ? "YOUR TURN TO MOVE" : `PLAYER ${record.domain.turn === 0 ? "A" : "B"}'S TURN`}
                      </span>
                    )}
                  </div>
                  <small className="status-banner__meta">
                    Revision {record.revision} · ply {record.domain.ply}/12
                  </small>
                </div>

                <div className="player-dockets">
                  <div className={`player-docket player-docket--a ${mine === record.primary.toLowerCase() ? "player-docket--you" : ""}`}>
                    <div className="player-docket__head">
                      <span className="player-badge player-badge--a" aria-hidden="true">▲ A</span>
                      <strong>Player A (Primary)</strong>
                      {mine === record.primary.toLowerCase() && <span className="you-pill">YOU</span>}
                    </div>
                    <code className="player-docket__addr" title={record.primary}>{short(record.primary)}</code>
                    <span className="player-docket__pos">
                      Position: Square {record.domain.positions[0]} {cellCoord(record.domain.positions[0])}
                    </span>
                  </div>

                  <div className={`player-docket player-docket--b ${mine === record.secondary.toLowerCase() ? "player-docket--you" : ""}`}>
                    <div className="player-docket__head">
                      <span className="player-badge player-badge--b" aria-hidden="true">● B</span>
                      <strong>Player B (Opponent)</strong>
                      {mine === record.secondary.toLowerCase() && <span className="you-pill">YOU</span>}
                    </div>
                    <code className="player-docket__addr" title={record.secondary}>{short(record.secondary)}</code>
                    <span className="player-docket__pos">
                      Position: Square {record.domain.positions[1]} {cellCoord(record.domain.positions[1])}
                    </span>
                  </div>
                </div>

                <div className="rule-inspector">
                  <div className="rule-inspector__header">
                    <span className="rule-inspector__title">FROZEN RULE PROVENANCE</span>
                    <span className="rule-inspector__status">
                      {record.base_locked ? "🔒 Immutable On-Chain" : "✎ Draft State"}
                    </span>
                  </div>
                  <p className="rule-inspector__prose">{record.base.rule}</p>
                </div>

                <div className="board-instrument">
                  <div className="board-instrument__coord-x">
                    <span>Col 0</span>
                    <span>Col 1</span>
                    <span>Col 2</span>
                  </div>
                  <div className="board-instrument__body">
                    <div className="board-instrument__coord-y">
                      <span>Row 0</span>
                      <span>Row 1</span>
                      <span>Row 2</span>
                    </div>
                    <div className="board" aria-label="3 by 3 game board">
                      {Array.from({ length: 9 }, (_, cell) => {
                        const isPlayerA = record.domain.positions[0] === cell;
                        const isPlayerB = record.domain.positions[1] === cell;
                        const player = isPlayerA ? "A" : isPlayerB ? "B" : "";
                        const from = record.domain.positions[record.domain.turn];
                        const enabled = Boolean(myTurn && legal[9 * from + cell] === "1" && cell !== from);
                        const isOrigin = Boolean(myTurn && from === cell);

                        return (
                          <button
                            key={cell}
                            type="button"
                            disabled={!enabled || busy}
                            className={`board-cell ${player ? `board-cell--player-${player.toLowerCase()}` : ""} ${enabled ? "board-cell--legal" : ""} ${isOrigin ? "board-cell--origin" : ""}`}
                            aria-label={`Cell ${cell}${player ? `, player ${player}` : ""}`}
                            onClick={() => action("move_piece", [from, cell, record.domain.ply])}
                          >
                            <span className="board-cell__coords" aria-hidden="true">
                              {cellCoord(cell)}
                            </span>
                            <span className="board-cell__display">
                              {player ? (
                                <span className="player-mark">
                                  <span className="player-mark__symbol" aria-hidden="true">
                                    {player === "A" ? "▲" : "●"}
                                  </span>
                                  <span className="player-mark__letter">{player}</span>
                                </span>
                              ) : enabled ? (
                                <span className="legal-indicator">
                                  <span className="legal-indicator__ring" aria-hidden="true" />
                                  <span className="legal-indicator__cell-num">{cell}</span>
                                </span>
                              ) : (
                                <span className="board-cell__cell-num">{cell}</span>
                              )}
                            </span>
                            {enabled && <span className="board-cell__pill" aria-hidden="true">LEGAL</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="actions" role="group" aria-label="Arena lifecycle actions">
                  {record.phase === "RULE_DRAFT" && mine === record.primary && (
                    <button type="button" className="btn btn--action-primary" onClick={() => action("freeze_rule")}>
                      Freeze rule
                    </button>
                  )}
                  {record.phase === "FROZEN" && (
                    <button type="button" className="btn btn--action-primary" onClick={() => action("compile_moves")}>
                      Compile 81 moves
                    </button>
                  )}
                  {record.phase === "UNRESOLVED" && (
                    <button type="button" className="btn btn--action-warning" onClick={() => action("retry_compile")}>
                      Retry compile
                    </button>
                  )}
                  {record.phase === "COMPILED" && mine === record.secondary && (
                    <button type="button" className="btn btn--action-accent" onClick={() => action("join_arena")}>
                      Join after inspection
                    </button>
                  )}
                  {record.phase === "PLAYING" && (
                    <button type="button" className="btn btn--action-danger" onClick={() => action("resign_arena")}>
                      Resign
                    </button>
                  )}
                  {["RULE_DRAFT", "FROZEN", "UNRESOLVED", "EXHAUSTED", "COMPILED"].includes(record.phase) &&
                    mine === record.primary && (
                      <button type="button" className="btn btn--action-cancel" onClick={() => action("cancel_arena")}>
                        Cancel
                      </button>
                    )}
                </div>

                {record.domain.matrix && (
                  <details className="matrix-inspection">
                    <summary>Inspect full 9 × 9 transition matrix</summary>
                    <div className="matrix-inspection__body">
                      <div className="matrix-legend-row">
                        <span className="matrix-legend-badge matrix-legend-badge--allowed">
                          <span className="legend-chip">1</span> Allowed Transition
                        </span>
                        <span className="matrix-legend-badge matrix-legend-badge--denied">
                          <span className="legend-chip">0</span> Denied Move
                        </span>
                        <span className="matrix-legend-badge matrix-legend-badge--diag">
                          <span className="legend-chip">✕</span> Self-Move Prohibited
                        </span>
                      </div>

                      <div className="matrix-table-container">
                        <table className="matrix-table" aria-label="9 by 9 transition relation table">
                          <thead>
                            <tr>
                              <th scope="col" className="matrix-th-corner">From \ To</th>
                              {Array.from({ length: 9 }, (_, to) => (
                                <th key={to} scope="col">C{to}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from({ length: 9 }, (_, from) => (
                              <tr key={from}>
                                <th scope="row">C{from}</th>
                                {Array.from({ length: 9 }, (_, to) => {
                                  const val = record.domain.matrix[from * 9 + to];
                                  const isDiag = from === to;
                                  return (
                                    <td
                                      key={to}
                                      className={`matrix-td matrix-td--${val === "1" ? "allowed" : "denied"} ${isDiag ? "matrix-td--diag" : ""}`}
                                      title={`Cell ${from} to Cell ${to}: ${val === "1" ? "Allowed" : "Denied"}`}
                                    >
                                      {isDiag ? "·" : val}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="matrix-raw-container">
                        <span className="matrix-raw-container__label">Canonical 81-character vector representation:</span>
                        <pre>{Array.from({ length: 9 }, (_, i) => record.domain.matrix.slice(i * 9, i * 9 + 9)).join("\n")}</pre>
                      </div>
                    </div>
                  </details>
                )}

                <div className="moves-history">
                  <h3 className="moves-history__title">Move history ({record.domain.moves.length} / 12 plies)</h3>
                  {record.domain.moves.length > 0 ? (
                    <ol className="moves-log">
                      {record.domain.moves.map((move, i) => (
                        <li key={i} className={`move-entry move-entry--actor-${move.actor}`}>
                          <span className="move-entry__ply">Ply #{i + 1}</span>
                          <span className="move-entry__actor">Player {move.actor === 0 ? "A" : "B"}:</span>
                          <span className="move-entry__delta">{move.from} → {move.to}</span>
                          <span className="move-entry__coord-note">
                            ({cellCoord(move.from)} → {cellCoord(move.to)})
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="no-moves-notice">
                      No moves played yet. Initial positions: Player A at Cell 0 (0,0), Player B at Cell 8 (2,2).
                    </p>
                  )}
                </div>

                {record.outcome && (
                  <div className={`outcome-card outcome-card--${record.outcome.toLowerCase()}`} role="status">
                    <span className="outcome-card__badge">GAME OUTCOME</span>
                    <strong className="outcome-card__heading">
                      Outcome: {phaseLabel(record.outcome)} {record.domain.winner && `· ${short(record.domain.winner)}`}
                    </strong>
                    <p className="outcome-card__desc">
                      {record.outcome === "CAPTURE" && `Player ${record.domain.winner?.toLowerCase() === record.primary.toLowerCase() ? "A" : "B"} won by capturing the opponent's piece.`}
                      {record.outcome === "NO_MOVE" && `Player ${record.domain.winner?.toLowerCase() === record.primary.toLowerCase() ? "A" : "B"} won because the opponent has no legal transitions from their square.`}
                      {record.outcome === "DRAW" && "The game ended in a draw after reaching the 12-ply maximum limit without capture."}
                      {record.outcome === "RESIGNED" && `Game ended by resignation. Winner: ${short(record.domain.winner)}.`}
                      {record.outcome === "CANCELLED" && "Arena was cancelled by the creator prior to play."}
                      {record.outcome === "UNPLAYABLE_RULE" && "Rule compiled but initial squares 0 or 8 have no outgoing moves. Gameplay is disabled."}
                      {record.outcome === "UNSUPPORTED_RULE" && "Rule cannot be compiled into a coordinate-only relation. Gameplay is disabled."}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-arena-placeholder">
                <span className="empty-arena-placeholder__glyph" aria-hidden="true">🗺</span>
                <p>Load an arena to inspect its frozen rule, compiled matrix, positions, and history.</p>
                <span className="empty-arena-placeholder__sub">
                  Enter an arena ID above to fetch verified contract state, or create an arena on the left.
                </span>
              </div>
            )}
          </section>
        </section>

        {progress.phase !== "IDLE" && (
          <TransactionProgress
            progress={progress}
            explorerUrl={progress.hash ? `https://explorer-studio.genlayer.com/tx/${progress.hash}` : undefined}
            onReconcile={reconcileTarget ? () => void reconcile(reconcileTarget) : undefined}
          />
        )}

        {notice && (
          <aside className="notice-banner" role="status" aria-live="polite">
            <span className="notice-banner__glyph" aria-hidden="true">ℹ</span>
            <span className="notice-banner__body">{notice}</span>
            <button
              type="button"
              className="notice-banner__dismiss"
              onClick={() => setNotice("")}
              aria-label="Dismiss notice"
            >
              ✕
            </button>
          </aside>
        )}

        <section id="journal" className="journal" aria-label="Transaction journal">
          <div className="section-head">
            <span className="section-head__eyebrow">MUTEX-LOCKED LOCAL WRITE LEDGER</span>
            <h2>Transaction journal</h2>
            <p className="section-head__desc">
              Before submission, each write receives a unique local reservation. Its transaction hash and verified readback remain available for safe recovery.
            </p>
          </div>

          {attempts.length === 0 ? (
            <div className="journal-empty">
              <span className="journal-empty__glyph" aria-hidden="true">📋</span>
              <p>No local attempts yet.</p>
              <span className="journal-empty__hint">
                Transactions initiated from this browser session will be tracked here with verified readback status.
              </span>
            </div>
          ) : (
            <ul className="journal-cards">
              {attempts.slice(0, 4).map((item) => (
                <li key={item.reservation} className={`journal-card journal-card--${item.status.toLowerCase()}`}>
                  <div className="journal-card__top">
                    <span className="journal-card__method">{phaseLabel(item.method)}</span>
                    <strong className="journal-card__status">{journalStatusLabel(item)}</strong>
                  </div>
                  <div className="journal-card__meta">
                    {item.tx_hash && (
                      <div className="journal-card__hash-row">
                        <span className="journal-card__hash-label">Tx Hash:</span>
                        <code className="journal-card__hash" title={item.tx_hash}>
                          {short(item.tx_hash)}
                        </code>
                      </div>
                    )}
                    <span className="journal-card__details">
                      Chain {item.chain} · Pre-rev {item.pre_revision} · Reservation {short(item.reservation)}
                    </span>
                  </div>
                  {["SIGNING", "SUBMITTED", "RECONCILE"].includes(item.status) && (
                    <div className="journal-card__actions">
                      <button
                        type="button"
                        className="btn btn--reconcile"
                        disabled={busy}
                        onClick={() => void reconcile(item)}
                      >
                        Continue verification
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="journal-footer-notice">
            Each attempt keeps an immutable reservation and transaction hash. Reconcile the existing hash; never submit a replacement.
          </p>
        </section>

        <section id="how" className="how">
          <div className="section-head">
            <span className="section-head__eyebrow">INDEPENDENT PROTOCOL CONSENSUS</span>
            <h2>How it works</h2>
            <p className="section-head__desc">
              The four-phase invariant guarantees that natural-language interpretation is locked and accepted before any gameplay begins.
            </p>
          </div>

          <div className="how-steps">
            <article className="how-step-card">
              <b className="how-step-card__num" aria-hidden="true">1</b>
              <span className="how-step-card__phase">PHASE 1 · INPUT</span>
              <h3>Write and freeze</h3>
              <p>Player A names Player B and freezes one coordinate-only rule.</p>
              <span className="how-step-card__note">Rule text is permanently locked in contract state. No modification is possible after freeze.</span>
            </article>

            <article className="how-step-card">
              <b className="how-step-card__num" aria-hidden="true">2</b>
              <span className="how-step-card__phase">PHASE 2 · CONSENSUS</span>
              <h3>Compile everything</h3>
              <p>Validators independently derive the same complete 81-cell relation. Unknown cells block play.</p>
              <span className="how-step-card__note">Consensus evaluates the rule once into all 81 transitions. Agreement produces the immutable matrix.</span>
            </article>

            <article className="how-step-card">
              <b className="how-step-card__num" aria-hidden="true">3</b>
              <span className="how-step-card__phase">PHASE 3 · CONSENT</span>
              <h3>Inspect and consent</h3>
              <p>Player B sees the immutable matrix before joining. Joining accepts this exact compiled revision.</p>
              <span className="how-step-card__note">Player B inspects the full relation and joins only by explicit consent to that exact compiled revision.</span>
            </article>

            <article className="how-step-card">
              <b className="how-step-card__num" aria-hidden="true">4</b>
              <span className="how-step-card__phase">PHASE 4 · PLAY</span>
              <h3>Play deterministically</h3>
              <p>Turns, capture, no-move, draw, and resignation use only contract state—never another model call.</p>
              <span className="how-step-card__note">Zero non-deterministic calls during play. All board moves are native, verifiable state transitions.</span>
            </article>
          </div>

          <div className="assessment-box">
            <span className="assessment-box__glyph" aria-hidden="true">⚖</span>
            <p>Assessment of this exact submitted material only; not verification of external facts.</p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer__inner">
          <div className="site-footer__brand-col">
            <strong className="site-footer__title">COMPILED BOARD MOVE ARENA</strong>
            <p className="site-footer__summary">
              Public finite transition rules laboratory on GenLayer intelligent contracts.
            </p>
          </div>
          <div className="site-footer__meta-col">
            <span className="site-footer__meta-item">Chain: <code>61997 (GenLayer Studio Dev)</code></span>
            <span className="site-footer__meta-item">Contract: <code>{short(contract)}</code></span>
            <span className="site-footer__meta-item">Readback: <code>Finalized execution + exact state</code></span>
          </div>
        </div>
        <div className="site-footer__disclaimer">
          <p>Assessment of this exact submitted material only; not verification of external facts.</p>
        </div>
      </footer>
    </div>
  );
}
