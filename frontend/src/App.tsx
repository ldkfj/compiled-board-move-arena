import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { browserDiscoveryHost } from "./wallet/providers";
import { createWalletStore, emptyWalletSessionState } from "./wallet/store";
import { createBrowserJournal, type JournalRecord } from "./pending";
import { executeWrite, INITIAL_WRITE_PROGRESS, type WriteProgress } from "./chain/writeCoordinator";
import { canonicalJson, chainIdDecimal, invalidateReadRequests, makeWriteAdapter, normalizeAddress, parseRecord, pollFinalized, randomHex, readCase, readIdByNonce, readVersion, requireContractAddress, sha256Hex, validateContractText, ZERO_HASH, type CaseRead, type WriteMethod } from "./contract";

const walletStore = typeof window === "undefined" ? null : createWalletStore(browserDiscoveryHost(), makeWriteAdapter);
const journal = typeof window === "undefined" ? null : createBrowserJournal();

function short(value: string) { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—"; }
function nextRevision(value: string) { return (BigInt(value) + 1n).toString(); }
function phaseLabel(value: string) { return value.replaceAll("_", " "); }

export function journalStatusLabel(record: JournalRecord): string {
  let classification = "";
  try { classification = String((JSON.parse(record.resolution_json) as { classification?: unknown }).classification ?? ""); } catch { classification = ""; }
  if (record.status === "FINALIZED_ERROR" && classification === "PRESENT") return "Finalized; expected state present";
  if (record.status === "FINALIZED_ERROR" && classification === "UNCHANGED") return "Finalized; state unchanged";
  if (record.status === "FINALIZED_ERROR" && classification === "COMPETING") return "Finalized; competing operation retained";
  return phaseLabel(record.status);
}

export default function App() {
  const wallet = useSyncExternalStore(walletStore?.subscribeWalletState ?? (() => () => {}), walletStore?.getWalletState ?? emptyWalletSessionState, walletStore?.getWalletState ?? emptyWalletSessionState);
  const view = walletStore?.selectWalletView() ?? { connected:false,chooserOpen:false,providerOptions:[],badge:"Disconnected",primaryAction:"Connect wallet",canWrite:false,error:"" };
  const [arena, setArena] = useState<CaseRead | null>(null);
  const [caseId, setCaseId] = useState("1");
  const [opponent, setOpponent] = useState("");
  const [rule, setRule] = useState("Move one square orthogonally; no diagonal moves.");
  const [progress, setProgress] = useState<WriteProgress>(INITIAL_WRITE_PROGRESS);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState<JournalRecord[]>([]);
  const contract = useMemo(() => { try { return requireContractAddress(); } catch { return ""; } }, []);

  useEffect(() => { void journal?.list().then(setAttempts).catch(() => setAttempts([])); return () => walletStore?.destroy(); }, []);

  async function load(id = caseId) {
    try { const value = await readCase(id); setArena(value); setCaseId(id); setNotice(""); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }

  async function write(method: WriteMethod, args: unknown[], intent: string, preRevision: string, nonce?: string) {
    if (!wallet.writeClient || !wallet.account || !journal || !contract) { setNotice("Connect a detected wallet and configure VITE_CONTRACT_ADDRESS."); return; }
    setBusy(true); setProgress(INITIAL_WRITE_PROGRESS); setNotice("");
    try {
      const argsJson = canonicalJson(args);
      const argsHash = await sha256Hex(argsJson);
      let resolvedId = arena?.record.id ?? "0";
      const outcome = await executeWrite({
        journal:{ chain:chainIdDecimal(),contract,account:wallet.account,method,intent,argsJson,preRevision,preHash:arena ? await sha256Hex(arena.raw) : ZERO_HASH,preStateJson:arena?.raw ?? "" },
        submit:() => wallet.writeClient!.submit(method, args as never[]),
        pollFinalized:wallet.writeClient.pollFinalized,
        verifyPre:async () => true,
        verifyPost:async (signal) => {
          invalidateReadRequests();
          if (nonce) resolvedId = await readIdByNonce(wallet.account!, nonce, contract, signal);
          const revision = nonce ? "1" : nextRevision(preRevision);
          const raw = await readVersion(resolvedId, revision, contract, signal);
          const record = raw ? parseRecord(raw) : null;
          if (!record || record.last_operation.method !== method || record.last_operation.caller !== wallet.account || record.last_operation.args_hash !== argsHash) return false;
          setArena({ raw:raw!, record }); setCaseId(resolvedId); return true;
        },
        progress:setProgress,
      }, { journal });
      setAttempts(await journal.list());
      setNotice(outcome.status === "VERIFIED" ? "Verified by finalized execution and exact historical readback." : outcome.status === "CANCELLED" ? "Wallet request cancelled; no transaction sent." : "Reconciliation required. The existing attempt is preserved; do not resubmit.");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const nonce = randomHex(16); const target = normalizeAddress(opponent); const frozenRule = validateContractText(rule,512);
      await write("create_arena", [nonce,target,frozenRule], `create:${wallet.account}:${nonce}`, "0", nonce);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }

  function action(method: WriteMethod, extras: unknown[] = []) {
    if (!arena) return;
    const args = [arena.record.id,...extras,arena.record.revision];
    void write(method,args,`${method}:${arena.record.id}:${arena.record.revision}${method === "move_piece" ? `:${arena.record.domain.ply}` : ""}`,arena.record.revision);
  }

  const record = arena?.record;
  const mine = wallet.account?.toLowerCase();
  const myTurn = record?.phase === "PLAYING" && mine === (record.domain.turn === 0 ? record.primary : record.secondary);
  const legal = record?.domain.matrix ?? "";

  return <main>
    <header><a className="brand" href="#top">Compiled Board Move Arena</a><nav><a href="#arena">Arena</a><a href="#how">How it works</a></nav><button onClick={() => walletStore?.openWalletPicker()}>{view.badge === "Disconnected" ? "Connect wallet" : view.badge}</button></header>
    {view.chooserOpen && <section className="wallet-dialog" role="dialog" aria-modal="true" aria-label="Choose wallet"><h2>Choose a detected wallet</h2>{view.providerOptions.length ? view.providerOptions.map(option => <button key={option.id} onClick={() => void walletStore?.selectWallet(option)}>{option.info?.icon&&<img src={option.info.icon} alt="" />}{option.name}</button>) : <p>No MetaMask, OKX Wallet, or Rabby provider detected.</p>}<button onClick={() => walletStore?.closeWalletPicker()}>Close</button>{view.error && <p role="alert">{view.error}</p>}</section>}
    <section className="hero" id="top"><p className="eyebrow">COMPILE · CONSENT · PLAY</p><h1>A movement rule that cannot change mid-game.</h1><p>GenLayer compiles one public rule into all 81 board transitions before the opponent joins. Every move after consent is deterministic and publicly replayable.</p><a className="cta" href="#arena">Open the arena</a></section>
    <section id="arena" className="workspace">
      <form className="panel" onSubmit={create}><h2>Create arena</h2><label>Opponent address<input value={opponent} onChange={e=>setOpponent(e.target.value)} placeholder="0x…" required /></label><label>Coordinate movement rule<textarea value={rule} onChange={e=>setRule(e.target.value)} maxLength={512} required /></label><p className="warning">All submitted text is public and permanent. Do not include private information, credentials, or personal records.</p><button disabled={busy || !view.canWrite}>Create arena</button></form>
      <section className="panel"><h2>Inspect arena</h2><div className="inline"><input aria-label="Arena ID" value={caseId} onChange={e=>setCaseId(e.target.value)} /><button onClick={()=>void load()} disabled={busy}>Load</button></div>{record ? <><div className="status"><span>{phaseLabel(record.phase)}</span><small>Revision {record.revision} · ply {record.domain.ply}/12</small></div><p>{record.base.rule}</p><div className="board" aria-label="3 by 3 game board">{Array.from({length:9},(_,cell)=>{const player=record.domain.positions[0]===cell?"A":record.domain.positions[1]===cell?"B":"";const from=record.domain.positions[record.domain.turn];const enabled=Boolean(myTurn && legal[9*from+cell]==="1" && cell!==from);return <button key={cell} disabled={!enabled||busy} aria-label={`Cell ${cell}${player?`, player ${player}`:""}`} onClick={()=>action("move_piece",[from,cell,record.domain.ply])}>{player||cell}</button>})}</div><div className="actions">{record.phase==="RULE_DRAFT"&&mine===record.primary&&<button onClick={()=>action("freeze_rule")}>Freeze rule</button>}{record.phase==="FROZEN"&&<button onClick={()=>action("compile_moves")}>Compile 81 moves</button>}{record.phase==="UNRESOLVED"&&<button onClick={()=>action("retry_compile")}>Retry compile</button>}{record.phase==="COMPILED"&&mine===record.secondary&&<button onClick={()=>action("join_arena")}>Join after inspection</button>}{record.phase==="PLAYING"&&<button onClick={()=>action("resign_arena")}>Resign</button>}{["RULE_DRAFT","FROZEN","UNRESOLVED","EXHAUSTED","COMPILED"].includes(record.phase)&&mine===record.primary&&<button onClick={()=>action("cancel_arena")}>Cancel</button>}</div>{record.domain.matrix&&<details><summary>Inspect full 9 × 9 transition matrix</summary><pre>{Array.from({length:9},(_,i)=>record.domain.matrix.slice(i*9,i*9+9)).join("\n")}</pre></details>}<ol>{record.domain.moves.map((move,i)=><li key={i}>Player {move.actor===0?"A":"B"}: {move.from} → {move.to}</li>)}</ol>{record.outcome&&<strong>Outcome: {phaseLabel(record.outcome)} {record.domain.winner&&`· ${short(record.domain.winner)}`}</strong>}</>:<p>Load an arena to inspect its frozen rule, compiled matrix, positions, and history.</p>}</section>
    </section>
    {(progress.phase!=="IDLE"||notice)&&<aside className="progress" aria-live="polite"><strong>{phaseLabel(progress.phase)}</strong>{progress.hash&&<code>{short(progress.hash)}</code>}<span>{notice||progress.message}</span></aside>}
    <section className="journal" aria-label="Transaction journal"><h2>Transaction journal</h2>{attempts.length===0?<p>No local attempts yet.</p>:<ul>{attempts.slice(0,4).map(item=><li key={item.reservation}><span>{phaseLabel(item.method)}</span><strong>{journalStatusLabel(item)}</strong>{item.tx_hash&&<code>{short(item.tx_hash)}</code>}</li>)}</ul>}<p>Each attempt keeps an immutable reservation and transaction hash. Reconcile the existing hash; never submit a replacement.</p></section>
    <section id="how" className="how"><h2>How it works</h2><div><article><b>1</b><h3>Write and freeze</h3><p>Player A names Player B and freezes one coordinate-only rule.</p></article><article><b>2</b><h3>Compile everything</h3><p>Validators independently derive the same complete 81-cell relation. Unknown cells block play.</p></article><article><b>3</b><h3>Inspect and consent</h3><p>Player B sees the immutable matrix before joining. Joining accepts this exact compiled revision.</p></article><article><b>4</b><h3>Play deterministically</h3><p>Turns, capture, no-move, draw, and resignation use only contract state—never another model call.</p></article></div><p>Assessment of this exact submitted material only; not verification of external facts.</p></section>
  </main>;
}
