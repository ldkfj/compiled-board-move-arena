export const JOURNAL_PREFIX = "glj1:";
export const JOURNAL_INDEX_KEY = "glj1:index";
export const JOURNAL_LOCK_NAME = "genlayer-journal-v1";
export const JOURNAL_CAPACITY = 32;

export const JOURNAL_STATUSES = [
  "SIGNING",
  "SUBMITTED",
  "RECONCILE",
  "FINALIZED_ERROR",
  "VERIFIED",
] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];
export type PendingStatus = "SIGNING" | "SUBMITTED" | "RECONCILE";

export interface JournalRecord {
  v: 1;
  reservation: string;
  chain: string;
  contract: string;
  account: string;
  method: string;
  intent: string;
  args_json: string;
  pre_revision: string;
  pre_hash: string;
  pre_state_json: string;
  tx_hash: string;
  status: JournalStatus;
  created_ms: string;
  resolution_json: string;
}

export interface SigningInput {
  chain: string;
  contract: string;
  account: string;
  method: string;
  intent: string;
  argsJson: string;
  preRevision: string;
  preHash: string;
  preStateJson?: string;
  createdMs?: string;
}

export interface UnknownJournalRecord {
  key: string;
  raw: string;
  error: string;
}

export interface JournalSnapshot {
  records: JournalRecord[];
  unknown: UnknownJournalRecord[];
}

export interface LockManagerLike {
  request(
    name: string,
    options: { mode: "exclusive" },
    callback: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown>;
}

export type JournalStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export type JournalErrorKind = "lock" | "data" | "conflict" | "capacity";

export class JournalError extends Error {
  readonly kind: JournalErrorKind;

  constructor(message: string, kind: JournalErrorKind) {
    super(message);
    this.name = "JournalError";
    this.kind = kind;
  }
}

function fail(message: string, kind: JournalErrorKind = "data"): never {
  throw new JournalError(message, kind);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || utf8Length(value) > maximum) {
    fail("Invalid journal text.");
  }
  return value;
}

function textAllowEmpty(value: unknown, maximum: number): string {
  if (typeof value !== "string" || utf8Length(value) > maximum) {
    fail("Invalid journal text.");
  }
  return value;
}

function decimal(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail("Invalid journal decimal.");
  }
  try {
    const number = BigInt(value);
    if (number < 0n || number > (1n << 256n) - 1n) fail("Invalid journal decimal.");
  } catch {
    fail("Invalid journal decimal.");
  }
  return value;
}

function address(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/.test(value)) {
    fail("Invalid journal address.");
  }
  return value;
}

function hex(value: unknown, digits: number): string {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${digits}}$`).test(value)) {
    fail("Invalid journal hex.");
  }
  return value;
}

function status(value: unknown): JournalStatus {
  if (typeof value !== "string" || !JOURNAL_STATUSES.includes(value as JournalStatus)) {
    fail("Invalid journal status.");
  }
  return value as JournalStatus;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("Non-finite JSON is not allowed.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalValue(value[key]);
    return result;
  }
  fail("Unsupported JSON value.");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function parseJsonRejectingDuplicateKeys(input: string): unknown {
  let offset = 0;

  function syntaxError(message: string): never {
    throw new Error(`Invalid journal JSON: ${message}`);
  }

  function skipWhitespace(): void {
    while (offset < input.length && /[\u0009\u000a\u000d\u0020]/.test(input[offset] ?? "")) offset += 1;
  }

  function parseString(): string {
    if (input[offset] !== '"') syntaxError("expected a string.");
    const start = offset;
    offset += 1;
    while (offset < input.length) {
      const code = input.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        try {
          return JSON.parse(input.slice(start, offset)) as string;
        } catch {
          syntaxError("invalid string.");
        }
      }
      if (code === 0x5c) {
        offset += 1;
        const escape = input[offset];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(input.slice(offset + 1, offset + 5))) syntaxError("invalid unicode escape.");
          offset += 5;
        } else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) {
          offset += 1;
        } else {
          syntaxError("invalid escape.");
        }
        continue;
      }
      if (code < 0x20) syntaxError("unescaped control character.");
      offset += 1;
    }
    syntaxError("unterminated string.");
  }

  function parseNumber(): number {
    const match = input.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) syntaxError("invalid number.");
    offset += match[0].length;
    return Number(match[0]);
  }

  function parseValue(): unknown {
    skipWhitespace();
    const token = input[offset];
    if (token === "{") return parseObject();
    if (token === "[") return parseArray();
    if (token === '"') return parseString();
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) return parseNumber();
    if (input.startsWith("true", offset)) {
      offset += 4;
      return true;
    }
    if (input.startsWith("false", offset)) {
      offset += 5;
      return false;
    }
    if (input.startsWith("null", offset)) {
      offset += 4;
      return null;
    }
    syntaxError("unexpected token.");
  }

  function parseArray(): unknown[] {
    offset += 1;
    const result: unknown[] = [];
    skipWhitespace();
    if (input[offset] === "]") {
      offset += 1;
      return result;
    }
    while (true) {
      result.push(parseValue());
      skipWhitespace();
      if (input[offset] === "]") {
        offset += 1;
        return result;
      }
      if (input[offset] !== ",") syntaxError("expected an array separator.");
      offset += 1;
      skipWhitespace();
    }
  }

  function parseObject(): Record<string, unknown> {
    offset += 1;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    skipWhitespace();
    if (input[offset] === "}") {
      offset += 1;
      return result;
    }
    while (true) {
      const key = parseString();
      if (keys.has(key)) syntaxError(`duplicate object key ${key}.`);
      keys.add(key);
      skipWhitespace();
      if (input[offset] !== ":") syntaxError("expected an object separator.");
      offset += 1;
      result[key] = parseValue();
      skipWhitespace();
      if (input[offset] === "}") {
        offset += 1;
        return result;
      }
      if (input[offset] !== ",") syntaxError("expected an object separator.");
      offset += 1;
      skipWhitespace();
    }
  }

  const parsed = parseValue();
  skipWhitespace();
  if (offset !== input.length) syntaxError("trailing data.");
  return parsed;
}

function parseCanonicalJson(value: string): void {
  try {
    const parsed = parseJsonRejectingDuplicateKeys(value);
    if (canonicalJson(parsed) !== value) fail("Journal arguments must be canonical JSON.");
  } catch (error) {
    if (error instanceof JournalError) throw error;
    fail("Journal arguments are not valid JSON.");
  }
}

export function journalKey(reservation: string): string {
  return JOURNAL_PREFIX + reservation;
}

const JOURNAL_RECORD_FIELDS = [
  "v",
  "reservation",
  "chain",
  "contract",
  "account",
  "method",
  "intent",
  "args_json",
  "pre_revision",
  "pre_hash",
  "pre_state_json",
  "tx_hash",
  "status",
  "created_ms",
  "resolution_json",
] as const;

export function validateJournalRecord(key: string, value: unknown): JournalRecord {
  if (!isObject(value)) fail("Journal record is not an object.");
  if (!exactKeys(value, JOURNAL_RECORD_FIELDS)) fail("Journal record has unexpected fields.");
  if (value.v !== 1) fail("Unsupported journal version.");
  const reservation = hex(value.reservation, 32);
  if (key !== journalKey(reservation)) fail("Journal key does not match its reservation.");
  const chain = decimal(value.chain);
  const contract = address(value.contract);
  const account = address(value.account);
  const method = text(value.method, 48);
  const intent = text(value.intent, 160);
  const argsJson = text(value.args_json, 18000);
  parseCanonicalJson(argsJson);
  const preRevision = decimal(value.pre_revision);
  const preHash = hex(value.pre_hash, 64);
  const preStateJson = textAllowEmpty(value.pre_state_json, 24576);
  if (preStateJson !== "") parseCanonicalJson(preStateJson);
  const txHash = value.tx_hash;
  if (typeof txHash !== "string" || (txHash !== "" && !/^0x[0-9a-f]{64}$/.test(txHash))) {
    fail("Invalid journal transaction hash.");
  }
  const recordStatus = status(value.status);
  const createdMs = decimal(value.created_ms);
  const resolutionJson = textAllowEmpty(value.resolution_json, 8192);
  if (resolutionJson === "") fail("Invalid journal resolution.");
  parseCanonicalJson(resolutionJson);
  return {
    v: 1,
    reservation,
    chain,
    contract,
    account,
    method,
    intent,
    args_json: argsJson,
    pre_revision: preRevision,
    pre_hash: preHash,
    pre_state_json: preStateJson,
    tx_hash: txHash,
    status: recordStatus,
    created_ms: createdMs,
    resolution_json: resolutionJson,
  };
}

function sortRecords(records: JournalRecord[]): JournalRecord[] {
  return [...records].sort((left, right) => {
    const time = BigInt(left.created_ms) - BigInt(right.created_ms);
    if (time !== 0n) return time < 0n ? -1 : 1;
    return left.reservation.localeCompare(right.reservation);
  });
}

function isPending(record: JournalRecord): record is JournalRecord & { status: PendingStatus } {
  return record.status === "SIGNING" || record.status === "SUBMITTED" || record.status === "RECONCILE";
}

function intentCaseId(intent: string): string | null {
  const match = /^[^:]+:([1-9][0-9]*):[1-9][0-9]*$/.exec(intent);
  return match ? match[1] : null;
}

function sameCase(left: JournalRecord, right: SigningInput): boolean {
  const leftCase = intentCaseId(left.intent);
  const rightCase = intentCaseId(right.intent);
  return (
    leftCase !== null &&
    rightCase !== null &&
    left.chain === right.chain &&
    left.contract === right.contract &&
    leftCase === rightCase
  );
}

async function sha256Text(value: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    fail("Journal lock unavailable.", "lock");
  }
}

export async function operationFingerprint(input: Pick<SigningInput, "chain" | "contract" | "account" | "method" | "intent">): Promise<string> {
  return sha256Text(canonicalJson([input.chain, input.contract, input.account, input.method, input.intent]));
}

function reservation(): string {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    fail("Journal lock unavailable.", "lock");
  }
}

function storageError(): never {
  fail("Journal lock unavailable.", "lock");
}

const TERMINAL_RESOLUTION_CLASSES = ["UNCHANGED", "PRESENT", "COMPETING"] as const;
const UNRESOLVED_RESOLUTION_CLASSES = ["ABSENT", "UNKNOWN"] as const;

function resolutionClass(value: string): string | null {
  try {
    const parsed = parseJsonRejectingDuplicateKeys(value) as unknown;
    if (!isObject(parsed) || typeof parsed.classification !== "string") return null;
    return parsed.classification;
  } catch {
    return null;
  }
}

function canAdvanceResolution(current: string, next: string): boolean {
  if (current === next || current === "{}") return true;
  const currentClass = resolutionClass(current);
  const nextClass = resolutionClass(next);
  return (
    UNRESOLVED_RESOLUTION_CLASSES.includes(currentClass as (typeof UNRESOLVED_RESOLUTION_CLASSES)[number]) &&
    TERMINAL_RESOLUTION_CLASSES.includes(nextClass as (typeof TERMINAL_RESOLUTION_CLASSES)[number])
  );
}

export class DurableJournal {
  private readonly storage: JournalStorage | null;
  private readonly locks: LockManagerLike | null;
  private readonly volatileRecovery = new Map<string, JournalRecord>();
  private signingHealthy = true;

  constructor(storage: JournalStorage | null, locks: LockManagerLike | null) {
    this.storage = storage;
    this.locks = locks;
  }

  async list(): Promise<JournalRecord[]> {
    return (await this.snapshot()).records;
  }

  async snapshot(): Promise<JournalSnapshot> {
    if (!this.storage) return { records: [], unknown: [] };
    return this.readSnapshotLockFree();
  }

  get signingAvailable(): boolean {
    return this.signingHealthy && this.storage !== null && this.locks !== null && typeof this.locks.request === "function";
  }

  rememberRecovery(record: JournalRecord): void {
    this.volatileRecovery.set(record.reservation, record);
  }

  async createSigning(input: SigningInput): Promise<JournalRecord> {
    if (!this.signingHealthy) storageError();
    if (!this.storage) storageError();
    const storage = this.storage;
    return this.withLock(async () => {
      const records = this.readAndRebuildIndexLocked();
      const fingerprint = await operationFingerprint(input);
      for (const record of records) {
        if (!isPending(record)) continue;
        if (sameCase(record, input)) throw new JournalError("A case operation is already pending.", "conflict");
        if (
          record.chain === input.chain &&
          record.contract === input.contract &&
          fingerprint ===
            (await operationFingerprint({
              chain: record.chain,
              contract: record.contract,
              account: record.account,
              method: record.method,
              intent: record.intent,
            }))
        ) {
          throw new JournalError("This operation is already pending.", "conflict");
        }
      }
      if (records.length >= JOURNAL_CAPACITY) {
        throw new JournalError("Journal capacity reached.", "capacity");
      }

      let record: JournalRecord | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate: JournalRecord = {
          v: 1,
          reservation: reservation(),
          chain: input.chain,
          contract: input.contract,
          account: input.account,
          method: input.method,
          intent: input.intent,
          args_json: input.argsJson,
          pre_revision: input.preRevision,
          pre_hash: input.preHash,
          pre_state_json: input.preStateJson ?? "",
          tx_hash: "",
          status: "SIGNING",
          created_ms: input.createdMs ?? String(Date.now()),
          resolution_json: "{}",
        };
        const key = journalKey(candidate.reservation);
        if (storage.getItem(key) === null) {
          record = validateJournalRecord(key, candidate);
          break;
        }
      }
      if (!record) storageError();
      this.writeRecordThenIndexLocked(record, records);
      return record;
    });
  }

  async update(key: string, next: JournalRecord): Promise<JournalRecord> {
    if (!this.storage) storageError();
    return this.withLock(async () => {
      const records = this.readAndRebuildIndexLocked();
      const current = records.find((record) => journalKey(record.reservation) === key);
      if (!current) fail("Journal record not found.");
      const validated = validateJournalRecord(key, next);
      for (const field of [
        "v",
        "reservation",
        "chain",
        "contract",
        "account",
        "method",
        "intent",
        "args_json",
        "pre_revision",
        "pre_hash",
        "pre_state_json",
        "created_ms",
      ] as const) {
        if (current[field] !== validated[field]) fail("Journal immutable fields changed.");
      }
      if (current.tx_hash !== "" && current.tx_hash !== validated.tx_hash) {
        fail("Journal transaction hash is immutable.");
      }
      if (!canAdvanceResolution(current.resolution_json, validated.resolution_json)) {
        fail("Journal resolution is immutable.");
      }
      this.writeRecordThenIndexLocked(validated, records);
      return validated;
    });
  }

  async removeUnsigned(key: string): Promise<void> {
    if (!this.storage) storageError();
    await this.withLock(async () => {
      const records = this.readAndRebuildIndexLocked();
      const current = records.find((record) => journalKey(record.reservation) === key);
      if (!current) fail("Journal record not found.");
      if (current.tx_hash !== "" || current.status !== "SIGNING") {
        fail("Only an unsigned reservation can be removed.");
      }
      try {
        this.storage?.removeItem(key);
        this.writeIndexLocked(records.filter((record) => journalKey(record.reservation) !== key));
        this.volatileRecovery.delete(current.reservation);
      } catch {
        storageError();
      }
    });
  }

  async archive(key: string): Promise<void> {
    if (!this.storage) storageError();
    await this.withLock(async () => {
      const records = this.readAndRebuildIndexLocked();
      const current = records.find((record) => journalKey(record.reservation) === key);
      if (!current) fail("Journal record not found.");
      if (current.status !== "VERIFIED" && current.status !== "FINALIZED_ERROR") {
        fail("Only reconciled terminal records can be archived.");
      }
      try {
        this.storage?.removeItem(key);
        this.writeIndexLocked(records.filter((record) => journalKey(record.reservation) !== key));
        this.volatileRecovery.delete(current.reservation);
      } catch {
        storageError();
      }
    });
  }

  private async withLock<T>(task: () => Promise<T>): Promise<T> {
    if (!this.locks || typeof this.locks.request !== "function") {
      this.signingHealthy = false;
      throw new JournalError("Journal lock unavailable.", "lock");
    }
    try {
      const result = await this.locks.request(JOURNAL_LOCK_NAME, { mode: "exclusive" }, async () => task());
      return result as T;
    } catch (error) {
      if (error instanceof JournalError && (error.kind === "conflict" || error.kind === "capacity")) throw error;
      this.signingHealthy = false;
      if (error instanceof JournalError && error.kind === "data") throw error;
      throw new JournalError("Journal lock unavailable.", "lock");
    }
  }

  private readAndRebuildIndexLocked(): JournalRecord[] {
    const snapshot = this.readSnapshotLockFree();
    if (snapshot.unknown.length > 0) {
      fail("Journal contains unreadable records; export or quarantine them before signing.", "data");
    }
    const sorted = snapshot.records;
    this.writeIndexLocked(sorted);
    return sorted;
  }

  private readRecordsLockFree(): JournalRecord[] {
    const snapshot = this.readSnapshotLockFree();
    if (snapshot.unknown.length > 0) {
      fail("Journal contains unreadable records; export or quarantine them before signing.", "data");
    }
    return snapshot.records;
  }

  private readSnapshotLockFree(): JournalSnapshot {
    if (!this.storage) return { records: [], unknown: [] };
    try {
      const records: JournalRecord[] = [];
      const unknown: UnknownJournalRecord[] = [];
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);
        if (!key || !key.startsWith(JOURNAL_PREFIX) || key === JOURNAL_INDEX_KEY) continue;
        const raw = this.storage.getItem(key);
        if (raw === null) {
          unknown.push({ key, raw: "", error: "Journal record disappeared while reading." });
          continue;
        }
        try {
          records.push(validateJournalRecord(key, parseJsonRejectingDuplicateKeys(raw)));
        } catch (error) {
          unknown.push({
            key,
            raw,
            error: error instanceof Error ? error.message : "Journal record is malformed.",
          });
        }
      }
      const merged = new Map(records.map((record) => [record.reservation, record]));
      for (const record of this.volatileRecovery.values()) merged.set(record.reservation, record);
      return { records: sortRecords([...merged.values()]), unknown };
    } catch (error) {
      this.signingHealthy = false;
      if (error instanceof JournalError) throw error;
      fail("Journal data could not be read.");
    }
  }

  private writeRecordThenIndexLocked(record: JournalRecord, previous: JournalRecord[]): void {
    if (!this.storage) storageError();
    const key = journalKey(record.reservation);
    try {
      this.storage.setItem(key, JSON.stringify(record));
      const records = previous.filter((item) => journalKey(item.reservation) !== key);
      records.push(record);
      this.writeIndexLocked(records);
      this.volatileRecovery.delete(record.reservation);
    } catch {
      storageError();
    }
  }

  private writeIndexLocked(records: JournalRecord[]): void {
    if (!this.storage) storageError();
    try {
      const keys = sortRecords(records).map((record) => journalKey(record.reservation));
      this.storage.setItem(JOURNAL_INDEX_KEY, JSON.stringify(keys));
    } catch {
      storageError();
    }
  }
}

export function createBrowserJournal(): DurableJournal {
  const browser = globalThis as unknown as {
    localStorage?: JournalStorage;
    navigator?: { locks?: LockManagerLike };
  };
  return new DurableJournal(browser.localStorage ?? null, browser.navigator?.locks ?? null);
}

