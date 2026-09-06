import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import {
  ExecutionResult,
  TransactionHashVariant,
  TransactionStatus,
} from "genlayer-js/types";
import type {
  Address as GenLayerAddress,
  CalldataEncodable,
  Hash as GenLayerHash,
} from "genlayer-js/types";
import type { ConnectedWallet } from "./wallet/connection";
import type { Eip1193Provider } from "./wallet/providers";
import { createRpcBudgetGuard, sharedReadClient } from "./chain/rpcBudget";

export const ZERO_HASH = "0".repeat(64);
export const WRITE_METHODS = [
  "create_arena", "freeze_rule", "compile_moves", "retry_compile",
  "join_arena", "move_piece", "resign_arena", "cancel_arena",
] as const;
export type WriteMethod = (typeof WRITE_METHODS)[number];

export interface CaseRecord {
  v: 1;
  id: string;
  primary: string;
  secondary: string;
  phase: string;
  revision: string;
  parent: string;
  create_hash: string;
  base: { rule: string };
  response: Record<string, unknown>;
  base_locked: boolean;
  response_locked: boolean;
  accepted_attempts: number;
  last_accepted_at: string;
  outcome: string;
  result: Record<string, unknown>;
  domain: { matrix: string; positions: [number, number]; turn: 0 | 1; ply: number; moves: Array<{actor: 0|1; from: number; to: number}>; winner: string };
  last_operation: Record<string, unknown>;
}

export interface CaseRead {
  raw: string;
  record: CaseRecord;
}

export interface ContractReceipt {
  statusName?: string;
  txExecutionResultName?: string;
  hash?: string;
  txId?: string;
  returnedCaseId?: string;
}

export interface ContractWriteAdapter {
  submit(method: WriteMethod, args: CalldataEncodable[]): Promise<string>;
  pollFinalized(hash: string, attempt?: number, signal?: AbortSignal): Promise<ContractReceipt | null>;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL_RE = /^(0|[1-9][0-9]*)$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const HASH_RE = /^0x?[0-9a-fA-F]{64}$/;
const CASE_PHASES = ["RULE_DRAFT", "FROZEN", "UNRESOLVED", "EXHAUSTED", "COMPILED", "PLAYING", "DONE"] as const;

function objectWithKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_RE.test(value);
}

function validHex(value: unknown, digits: number): value is string {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${digits}}$`).test(value);
}

function validAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/.test(value);
}

export function isExactCaseRecord(value: unknown): value is CaseRecord {
  if (!objectWithKeys(value, [
    "v", "id", "primary", "secondary", "phase", "revision", "parent", "create_hash", "base",
    "response", "base_locked", "response_locked", "accepted_attempts", "last_accepted_at", "outcome",
    "result", "domain", "last_operation",
  ])) return false;
  const record = value as Record<string, unknown>;
  if (
    record.v !== 1 || !validDecimal(record.id) || record.id === "0" || !validAddress(record.primary) ||
    !validAddress(record.secondary) || record.primary === record.secondary ||
    typeof record.phase !== "string" || !CASE_PHASES.includes(record.phase as (typeof CASE_PHASES)[number]) ||
    !validDecimal(record.revision) || record.revision === "0" || record.parent !== "0" ||
    !validHex(record.create_hash, 64) || typeof record.base_locked !== "boolean" ||
    typeof record.response_locked !== "boolean" || !Number.isSafeInteger(record.accepted_attempts) ||
    (record.accepted_attempts as number) < 0 || (record.accepted_attempts as number) > 3 ||
    !validDecimal(record.last_accepted_at) || typeof record.outcome !== "string" ||
    !["", "COMPILED", "UNSUPPORTED_RULE", "UNPLAYABLE_RULE", "CAPTURE", "DRAW", "NO_MOVE", "RESIGNED", "CANCELLED"].includes(record.outcome)
  ) return false;

  if (!objectWithKeys(record.base, ["rule"]) || !hasValidContractText(record.base.rule, 512, false)) return false;

  if (typeof record.response !== "object" || record.response === null || Array.isArray(record.response)) return false;
  const response = record.response as Record<string, unknown>;
  if (Object.keys(response).length !== 0) return false;

  if (typeof record.result !== "object" || record.result === null || Array.isArray(record.result)) return false;
  const result = record.result as Record<string, unknown>;
  if (Object.keys(result).length !== 0 && (!objectWithKeys(result, ["v", "supported", "cells"]) || result.v !== 1 || typeof result.supported !== "boolean" || typeof result.cells !== "string" || !/^[ADU]{81}$/.test(result.cells))) return false;

  if (!objectWithKeys(record.domain, ["matrix", "positions", "turn", "ply", "moves", "winner"])) return false;
  const domain = record.domain as Record<string, unknown>;
  if (typeof domain.matrix !== "string" || !/^(|[01]{81})$/.test(domain.matrix) || !Array.isArray(domain.positions) || domain.positions.length !== 2 || !domain.positions.every((x) => Number.isInteger(x) && x >= 0 && x <= 8) || (domain.turn !== 0 && domain.turn !== 1) || !Number.isInteger(domain.ply) || (domain.ply as number) < 0 || (domain.ply as number) > 12 || !Array.isArray(domain.moves) || typeof domain.winner !== "string") return false;

  if (typeof record.last_operation !== "object" || record.last_operation === null || Array.isArray(record.last_operation)) return false;
  const operation = record.last_operation as Record<string, unknown>;
  if (Object.keys(operation).length !== 0 && (!objectWithKeys(operation, ["method", "caller", "args_hash"]) || typeof operation.method !== "string" || !WRITE_METHODS.includes(operation.method as WriteMethod) || !validAddress(operation.caller) || !validHex(operation.args_hash, 64))) return false;
  return true;
}

export function normalizeAddress(value: unknown): string {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    throw new Error("Invalid address.");
  }
  return value.toLowerCase();
}

export function normalizeText(value: unknown): string {
  if (typeof value !== "string") throw new Error("Text is required.");
  return value.replace(/\r\n/g, "\n");
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
      } else {
        return true;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasValidContractText(value: unknown, maximum: number, allowEmpty: boolean): value is string {
  if (typeof value !== "string") return false;
  const normalized = normalizeText(value);
  if (normalized !== value || (!allowEmpty && normalized.length === 0)) return false;
  if (hasUnpairedSurrogate(normalized)) return false;
  if (new TextEncoder().encode(normalized).byteLength > maximum) return false;
  for (const character of normalized) {
    const code = character.charCodeAt(0);
    if (code < 32 && character !== "\n" && character !== "\t") return false;
  }
  return true;
}

export function validateContractText(value: unknown, maximum: number, allowEmpty = false): string {
  const normalized = normalizeText(value);
  if (!hasValidContractText(normalized, maximum, allowEmpty)) {
    throw new Error("Text does not match the contract limits.");
  }
  return normalized;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite JSON is not allowed.");
    return value;
  }
  if (typeof value === "bigint") throw new Error("BigInt must be rendered as a decimal string.");
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) result[key] = canonicalValue(object[key]);
    return result;
  }
  throw new Error("Unsupported JSON value.");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomHex(bytes: number): string {
  if (!Number.isInteger(bytes) || bytes < 1) throw new Error("Invalid random byte count.");
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function computeCommitment(input: {
  creator: string;
  opponent: string;
  nonce: string;
  clue: string;
  answer: string;
  salt: string;
  chain?: string;
  contract?: string;
}): Promise<string> {
  const contract = input.contract ?? requireContractAddress();
  const preimage = [
    "ANSWER_MATCH_V1",
    input.chain ?? String(studionet.id),
    normalizeAddress(contract),
    normalizeAddress(input.creator),
    normalizeAddress(input.opponent),
    input.nonce,
    validateContractText(input.clue, 512),
    validateContractText(input.answer, 256),
    input.salt,
  ];
  return sha256Hex(canonicalJson(preimage));
}

export function requireContractAddress(): string {
  const value = import.meta.env.VITE_CONTRACT_ADDRESS?.trim().toLowerCase() ?? "";
  if (!ADDRESS_RE.test(value)) throw new Error("Contract is not configured.");
  return value;
}

function rpcContractAddress(value: string): string {
  const normalized = normalizeAddress(value);
  const configured = import.meta.env.VITE_CONTRACT_ADDRESS?.trim() ?? "";
  return ADDRESS_RE.test(configured) && configured.toLowerCase() === normalized ? configured : value.trim();
}

function requireId(value: string): bigint {
  if (!DECIMAL_RE.test(value) || value === "0") throw new Error("Invalid case ID.");
  return BigInt(value);
}

function requireRevision(value: string): bigint {
  if (!DECIMAL_RE.test(value) || value === "0") throw new Error("Invalid revision.");
  return BigInt(value);
}

function requireNonce(value: string): string {
  if (!NONCE_RE.test(value)) throw new Error("Invalid nonce.");
  return value;
}

function parseCase(raw: unknown): CaseRead {
  if (typeof raw !== "string" || raw === "null") throw new Error("Case not found.");
  const record = JSON.parse(raw) as unknown;
  if (!isExactCaseRecord(record)) throw new Error("Invalid case response.");
  return { raw, record };
}

const readClient = sharedReadClient("studionet", () => createClient({ chain: studionet }));
const readRpcBudget = createRpcBudgetGuard([
  { id: "contract-read", maxRequests: 1000, maxRetries: 0, baseBackoffMs: 200, cacheTtlMs: 0 },
  { id: "latest-block", maxRequests: 1000, maxRetries: 0, baseBackoffMs: 200, cacheTtlMs: 0 },
  { id: "transaction-status", maxRequests: 1000, maxRetries: 0, baseBackoffMs: 200, cacheTtlMs: 0 },
  { id: "terminal-receipt", maxRequests: 1000, maxRetries: 0, baseBackoffMs: 200, cacheTtlMs: 0 },
]);

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return { bigint: value.toString(10) };
  if (value instanceof Uint8Array) return { bytes: [...value] };
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value instanceof Map) return [...value.entries()].map(([key, entry]) => [key, jsonSafe(entry)]);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]));
  }
  return value;
}

async function readValue(functionName: string, args: CalldataEncodable[], contractAddress = requireContractAddress(), signal?: AbortSignal): Promise<unknown> {
  const normalizedContract = normalizeAddress(contractAddress);
  const rpcAddress = rpcContractAddress(contractAddress);
  const key = canonicalJson([chainIdDecimal(), normalizedContract, functionName, jsonSafe(args)]);
  return readRpcBudget.request({
    rowId: "contract-read",
    key,
    signal: signal ?? new AbortController().signal,
    call: () => readClient.readContract({
      address: rpcAddress as GenLayerAddress,
      functionName,
      args,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    }),
  });
}

export function invalidateReadRequests(): void {
  readRpcBudget.invalidate(() => true);
}

export async function readCase(caseId: string, contractAddress = requireContractAddress(), signal?: AbortSignal): Promise<CaseRead> {
  const raw = await readValue("get_case", [requireId(caseId)], contractAddress, signal);
  return parseCase(raw);
}

export async function readVersion(caseId: string, revision: string, contractAddress = requireContractAddress(), signal?: AbortSignal): Promise<string | null> {
  const raw = await readValue("get_version", [requireId(caseId), requireRevision(revision)], contractAddress, signal);
  if (raw === "null") return null;
  if (typeof raw !== "string") throw new Error("Invalid history response.");
  return raw;
}

export async function readIdByNonce(creator: string, nonce: string, contractAddress = requireContractAddress(), signal?: AbortSignal): Promise<string> {
  const value = await readValue("get_id_by_nonce", [normalizeAddress(creator) as GenLayerAddress, requireNonce(nonce)], contractAddress, signal);
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && DECIMAL_RE.test(value)) return value;
  throw new Error("Invalid nonce lookup response.");
}

export async function readChainTime(signal?: AbortSignal): Promise<string> {
  const block = await readRpcBudget.request({
    rowId: "latest-block",
    key: `${chainIdDecimal()}:latest`,
    signal: signal ?? new AbortController().signal,
    call: () => readClient.getBlock({ blockTag: "latest" }),
  });
  const timestamp = block.timestamp;
  if (typeof timestamp !== "bigint" && typeof timestamp !== "number" && typeof timestamp !== "string") throw new Error("Chain time unavailable.");
  const value = String(timestamp);
  if (!DECIMAL_RE.test(value)) throw new Error("Chain time unavailable.");
  return value;
}

const TRANSACTION_STATUS_NAMES = Object.values(TransactionStatus) as string[];
const EXECUTION_RESULT_NAMES = Object.values(ExecutionResult) as string[];

function statusName(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
    if (TRANSACTION_STATUS_NAMES.includes(normalized)) return normalized;
    const numeric = Number(value);
    return Number.isInteger(numeric) ? TRANSACTION_STATUS_NAMES[numeric] : undefined;
  }
  if (typeof value === "number" && Number.isInteger(value)) return TRANSACTION_STATUS_NAMES[value];
  return undefined;
}

function executionResultName(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
    if (EXECUTION_RESULT_NAMES.includes(normalized)) return normalized;
    if (["RETURN", "SUCCESS", "FINISHED", "FINISHED_RETURN"].includes(normalized)) return ExecutionResult.FINISHED_WITH_RETURN;
    if (["ERROR", "FAILURE", "FAILED", "FINISHED_ERROR"].includes(normalized)) return ExecutionResult.FINISHED_WITH_ERROR;
    const numeric = Number(value);
    return Number.isInteger(numeric) ? EXECUTION_RESULT_NAMES[numeric] : undefined;
  }
  if (typeof value === "number" && Number.isInteger(value)) return EXECUTION_RESULT_NAMES[value];
  return undefined;
}

function nestedExecutionResult(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return executionResultName(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const direct = executionResultName(
    object.txExecutionResultName ?? object.tx_execution_result_name ?? object.txExecutionResult ??
    object.tx_execution_result ?? object.executionResult ?? object.execution_result ?? object.resultName ??
    (typeof object.result === "string" ? object.result : undefined) ?? object.name ?? object.message,
  );
  if (direct) return direct;
  if (typeof object.code === "number") {
    if (object.code === 0) return ExecutionResult.FINISHED_WITH_RETURN;
    if (object.code > 0) return ExecutionResult.FINISHED_WITH_ERROR;
  }
  for (const child of [object.data, object.result, object.leader_receipt, object.leaderReceipt, object.consensus_data]) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const result = nestedExecutionResult(item);
        if (result) return result;
      }
    } else {
      const result = nestedExecutionResult(child);
      if (result) return result;
    }
  }
  return undefined;
}

export function parseTransactionStatus(raw: unknown): string | undefined {
  if (typeof raw === "string" || typeof raw === "number") return statusName(raw);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const body = raw as { status?: unknown; statusCode?: unknown };
  return statusName(body.status) ?? statusName(body.statusCode);
}

function returnedCaseId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const transaction = value as { consensus_data?: { leader_receipt?: unknown[] } };
  const leaderReceipt = transaction.consensus_data?.leader_receipt;
  const result = Array.isArray(leaderReceipt) && leaderReceipt.length > 0 ? leaderReceipt[0] : undefined;
  if (typeof result !== "object" || result === null) return undefined;
  const payload = (result as { result?: { payload?: { readable?: unknown } } }).result?.payload;
  const readable = payload?.readable;
  if (typeof readable !== "string" || !/^[1-9][0-9]*$/.test(readable)) return undefined;
  return readable;
}

type RpcRequest = (args: { method: string; params?: unknown[] }) => Promise<unknown>;

async function lightweightTransactionStatus(client: ReturnType<typeof createClient>, hash: string, signal?: AbortSignal): Promise<string> {
  const request = client.request as unknown as RpcRequest;
  const response = await readRpcBudget.request({
    rowId: "transaction-status",
    key: hash,
    signal: signal ?? new AbortController().signal,
    call: () => request({ method: "gen_getTransactionStatus", params: [hash] }),
  });
  const name = parseTransactionStatus(response);
  if (!name) throw new Error("Transaction status response is invalid.");
  return name;
}

export function parseTransactionReceipt(raw: unknown): ContractReceipt | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const finalStatus = statusName(value.statusName ?? value.status_name ?? value.status);
  if (finalStatus !== TransactionStatus.FINALIZED) return null;
  const nested = value.data as Record<string, unknown> | undefined;
  const execution = nestedExecutionResult({ ...value, data: nested });
  const id = typeof value.id === "string" ? value.id : undefined;
  return {
    statusName: finalStatus,
    txExecutionResultName: execution,
    hash: typeof value.hash === "string" ? value.hash : id,
    txId: typeof value.txId === "string" ? value.txId : typeof value.tx_id === "string" ? value.tx_id : id,
    returnedCaseId: returnedCaseId(raw),
  };
}

async function fullFinalizedReceipt(client: ReturnType<typeof createClient>, hash: string, signal?: AbortSignal): Promise<ContractReceipt | null> {
  const receipt = await readRpcBudget.request({
    rowId: "terminal-receipt",
    key: hash,
    signal: signal ?? new AbortController().signal,
    // The deployed legacy node has no gen_getTransactionReceipt method. The
    // pinned SDK normalizes its compatible eth_getTransactionByHash response
    // into the GenLayer transaction shape we need for execution verification.
    call: () => client.getTransaction({ hash: hash as GenLayerHash }),
  });
  return parseTransactionReceipt(receipt);
}

async function pollClientFinalized(client: ReturnType<typeof createClient>, hash: string, attempt: number, signal?: AbortSignal): Promise<ContractReceipt | null> {
  if (attempt < 3) {
    const status = await lightweightTransactionStatus(client, hash, signal);
    if (status !== TransactionStatus.FINALIZED) return null;
  }
  return fullFinalizedReceipt(client, hash, signal);
}

export function parseRecord(raw: string): CaseRecord | null {
  if (raw === "null") return null;
  const parsed = JSON.parse(raw) as unknown;
  return isExactCaseRecord(parsed) ? parsed : null;
}

export function makeWriteAdapter(wallet: ConnectedWallet): ContractWriteAdapter {
  const address = requireContractAddress() as GenLayerAddress;
  const provider = wallet.provider as Eip1193Provider;
  const client = createClient({
    chain: studionet,
    account: wallet.account as GenLayerAddress,
    provider,
  });
  return {
    async submit(method, args) {
      const hash = await client.writeContract({
        address,
        functionName: method,
        args,
        value: 0n,
        consensusMaxRotations: 3,
      });
      if (typeof hash !== "string" || !HASH_RE.test(hash)) throw new Error("Wallet did not return a transaction hash.");
      return hash.toLowerCase().startsWith("0x") ? hash.toLowerCase() : `0x${hash.toLowerCase()}`;
    },
    async pollFinalized(hash, attempt = 1, signal) {
      return pollClientFinalized(client, hash, attempt, signal);
    },
  };
}

export async function pollFinalized(hash: string, attempt = 1, signal?: AbortSignal): Promise<ContractReceipt | null> {
  return pollClientFinalized(readClient, hash, attempt, signal);
}

export function isSuccessfulReceipt(receipt: ContractReceipt): boolean {
  return (
    receipt.statusName === TransactionStatus.FINALIZED &&
    receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN
  );
}

export function chainIdDecimal(): string {
  return String(studionet.id);
}
