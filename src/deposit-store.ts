import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RECORD_GUIDANCE,
  DepositRefusal,
  DepositUserError,
  assertAmountWrite,
  assertDateMove,
  assertMarkPaid,
  assertNewLaterPayment,
  assertScriptWrite,
  assertWaive,
  buildMayTellClient,
  labelKey,
  type ChangeKind,
  type DepositStanding,
  type MayTellClient,
  type PaymentTarget,
  type ScheduleStatus
} from "./deposit-policy.js";

export type { ChangeKind, DepositStanding, MayTellClient, PaymentTarget, ScheduleStatus };

const MAX_SCHEDULES = 50;
const PAGE_SIZE = 20;
const MAX_LATER = 40;
const MAX_CHANGES = 200;
const MAX_SUPPORT = 200;
const MAX_MINOR = 100_000_000;

export type Deposit = {
  amountMinor: number;
  dueOn: string;
  standing: DepositStanding;
  updatedAt: string;
};

export type LaterPayment = {
  id: string;
  label: string;
  amountMinor: number;
  dueOn: string;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleChange = {
  id: string;
  kind: ChangeKind;
  status: "proposed" | "approved";
  summary: string;
  target: PaymentTarget | null;
  paymentId: string | null;
  dueOn: string | null;
  amountMinor: number | null;
  label: string | null;
  script: string | null;
  applied: boolean;
  createdAt: string;
  approvedAt: string | null;
};

export type Schedule = {
  id: string;
  clientName: string;
  projectTitle: string;
  reference: string;
  currency: string;
  status: ScheduleStatus;
  approvedAt: string | null;
  deposit: Deposit | null;
  laterPayments: LaterPayment[];
  clientScript: string | null;
  changes: ScheduleChange[];
  createdAt: string;
  updatedAt: string;
};

export type ScheduleSummary = {
  id: string;
  clientName: string;
  projectTitle: string;
  reference: string;
  currency: string;
  status: ScheduleStatus;
  depositStanding: DepositStanding | "unrecorded";
  depositDueOn: string | null;
  laterCount: number;
};

export type Profile = {
  userId: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type ScheduleRecord = {
  schedule: {
    id: string;
    clientName: string;
    projectTitle: string;
    reference: string;
    currency: string;
    status: ScheduleStatus;
    approvedAt: string | null;
  };
  deposit: Deposit | null;
  laterPayments: LaterPayment[];
  clientScript: string | null;
  mayTellClient: MayTellClient;
  approvedChanges: ScheduleChange[];
  proposedChanges: ScheduleChange[];
  guidance: string;
};

export type StartScheduleInput = {
  clientName: string;
  projectTitle: string;
  reference: string;
  currency: string;
};

export type RecordDepositInput = {
  scheduleId: string;
  amountMinor: number;
  dueOn: string;
};

export type LaterPaymentInput = {
  scheduleId: string;
  label: string;
  amountMinor: number;
  dueOn: string;
};

export type MovePaymentInput = {
  scheduleId: string;
  dueOn: string;
  target: PaymentTarget;
  paymentId?: string;
};

export type ClientScriptInput = {
  scheduleId: string;
  script: string;
};

export type SuggestChangeInput = {
  scheduleId: string;
  kind: ChangeKind;
  summary: string;
  target?: PaymentTarget;
  paymentId?: string;
  dueOn?: string;
  amountMinor?: number;
  label?: string;
  script?: string;
};

type SupportRequest = { id: string; email: string; message: string; createdAt: string };

type FileData = {
  version: 1;
  profiles: Record<string, Profile>;
  schedules: Record<string, Schedule[]>;
  supportRequests: SupportRequest[];
};

export type DepositStore = {
  getProfile(userId: string): Promise<Profile>;
  updateProfile(userId: string, patch: Partial<Omit<Profile, "userId">>): Promise<Profile>;
  listSchedules(userId: string, offset: number): Promise<{ schedules: ScheduleSummary[]; nextOffset: number | null }>;
  startSchedule(userId: string, input: StartScheduleInput): Promise<Schedule>;
  readSchedule(userId: string, scheduleId: string): Promise<ScheduleRecord>;
  recordDeposit(userId: string, input: RecordDepositInput): Promise<Deposit>;
  addLaterPayment(userId: string, input: LaterPaymentInput): Promise<LaterPayment>;
  movePaymentDate(userId: string, input: MovePaymentInput): Promise<{ target: PaymentTarget; paymentId: string | null; dueOn: string }>;
  waiveDeposit(userId: string, scheduleId: string): Promise<Deposit>;
  markDepositPaid(userId: string, scheduleId: string): Promise<Deposit>;
  writeClientScript(userId: string, input: ClientScriptInput): Promise<{ clientScript: string }>;
  commitSchedule(userId: string, scheduleId: string): Promise<ScheduleRecord>;
  suggestScheduleChange(userId: string, input: SuggestChangeInput): Promise<ScheduleChange>;
  acceptScheduleChange(userId: string, scheduleId: string, changeId: string): Promise<ScheduleRecord>;
  addSupportRequest(input: { email: string; message: string }): Promise<{ id: string }>;
};

const FOREIGN_DATA_FILES = [
  [".scope", "scope.json"],
  [".retain", "retain.json"],
  [".invoice", "invoice.json"]
] as const;

export function defaultDepositDataPath(): string {
  return path.join(os.homedir(), ".deposit", "deposit.json");
}

export function assertDepositDataPath(filePath: string): string {
  const trimmed = filePath.trim();
  const expanded = trimmed === "~"
    ? os.homedir()
    : trimmed.startsWith("~/")
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed;
  const resolved = path.resolve(expanded);
  const forbidden = FOREIGN_DATA_FILES.map(([dir, file]) => path.resolve(path.join(os.homedir(), dir, file)));
  if (forbidden.includes(resolved)) throw new DepositUserError("Deposit data must use its own file.");
  return resolved;
}

function emptyData(): FileData {
  return { version: 1, profiles: {}, schedules: {}, supportRequests: [] };
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (!text || text.length > max) throw new DepositUserError(`${label} must be 1–${max} characters.`);
  return text;
}

function assertMinor(value: number, label = "Amount"): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_MINOR) {
    throw new DepositUserError(`${label} must be a whole number of minor units from 1 to ${MAX_MINOR}.`);
  }
  return value;
}

function assertCurrency(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new DepositUserError("Currency must be a three-letter code.");
  return code;
}

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DepositUserError("Payment date must be a calendar date.");
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new DepositUserError("Payment date must be a calendar date.");
  }
  return value;
}

function blankProfile(userId: string): Profile {
  return {
    userId,
    subscriptionStatus: "none",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false
  };
}

function summary(schedule: Schedule): ScheduleSummary {
  return {
    id: schedule.id,
    clientName: schedule.clientName,
    projectTitle: schedule.projectTitle,
    reference: schedule.reference,
    currency: schedule.currency,
    status: schedule.status,
    depositStanding: schedule.deposit?.standing ?? "unrecorded",
    depositDueOn: schedule.deposit?.dueOn ?? null,
    laterCount: schedule.laterPayments.length
  };
}

function toRecord(schedule: Schedule): ScheduleRecord {
  return {
    schedule: {
      id: schedule.id,
      clientName: schedule.clientName,
      projectTitle: schedule.projectTitle,
      reference: schedule.reference,
      currency: schedule.currency,
      status: schedule.status,
      approvedAt: schedule.approvedAt
    },
    deposit: schedule.deposit,
    laterPayments: schedule.laterPayments,
    clientScript: schedule.clientScript,
    mayTellClient: buildMayTellClient({
      status: schedule.status,
      currency: schedule.currency,
      deposit: schedule.deposit,
      laterPayments: schedule.laterPayments,
      clientScript: schedule.clientScript
    }),
    approvedChanges: schedule.changes.filter((change) => change.status === "approved"),
    proposedChanges: schedule.changes.filter((change) => change.status === "proposed"),
    guidance: RECORD_GUIDANCE
  };
}

function schedulesFor(data: FileData, userId: string): Schedule[] {
  const rows = data.schedules[userId];
  if (!rows) {
    data.schedules[userId] = [];
    return data.schedules[userId];
  }
  return rows;
}

function findSchedule(data: FileData, userId: string, scheduleId: string): Schedule {
  const schedule = (data.schedules[userId] ?? []).find((row) => row.id === scheduleId);
  if (!schedule) throw new DepositUserError("Schedule not found");
  return schedule;
}

function findPayment(schedule: Schedule, paymentId: string): LaterPayment {
  const payment = schedule.laterPayments.find((row) => row.id === paymentId);
  if (!payment) throw new DepositUserError("Payment not found");
  return payment;
}

function requireDeposit(schedule: Schedule, purpose: string): Deposit {
  if (!schedule.deposit) throw new DepositUserError(`A deposit is required before ${purpose}.`);
  return schedule.deposit;
}

function blankChange(kind: ChangeKind, summary: string): ScheduleChange {
  const stamp = nowIso();
  return {
    id: randomUUID(),
    kind,
    status: "proposed",
    summary,
    target: null,
    paymentId: null,
    dueOn: null,
    amountMinor: null,
    label: null,
    script: null,
    applied: false,
    createdAt: stamp,
    approvedAt: null
  };
}

export function createFileDepositStore(filePath: string): DepositStore {
  const resolved = assertDepositDataPath(filePath);
  let chain: Promise<void> = Promise.resolve();

  async function read(): Promise<FileData> {
    try {
      const text = await readFile(resolved, "utf8");
      if (!text.trim()) return emptyData();
      const parsed = JSON.parse(text) as FileData;
      if (parsed.version !== 1 || !parsed.profiles || !parsed.schedules || !Array.isArray(parsed.supportRequests)) {
        throw new DepositUserError("Deposit data could not be read.");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyData();
      if (error instanceof DepositUserError) throw error;
      throw new DepositUserError("Deposit data could not be read.");
    }
  }

  async function write(data: FileData): Promise<void> {
    await mkdir(path.dirname(resolved), { recursive: true });
    const tmp = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, resolved);
  }

  function enqueue<T>(fn: (data: FileData) => T, persist: boolean): Promise<T> {
    const run = chain.then(async () => {
      const data = await read();
      const result = fn(data);
      if (persist) await write(data);
      return structuredClone(result);
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return {
    getProfile(userId) {
      return enqueue((data) => data.profiles[userId] ?? blankProfile(userId), false);
    },
    updateProfile(userId, patch) {
      return enqueue((data) => {
        const current = data.profiles[userId] ?? blankProfile(userId);
        const next: Profile = { ...current, ...patch, userId };
        data.profiles[userId] = next;
        return next;
      }, true);
    },
    listSchedules(userId, offset) {
      return enqueue((data) => {
        const rows = data.schedules[userId] ?? [];
        const start = Math.max(0, offset);
        const page = rows.slice(start, start + PAGE_SIZE).map(summary);
        const nextOffset = start + page.length < rows.length ? start + page.length : null;
        return { schedules: page, nextOffset };
      }, false);
    },
    startSchedule(userId, input) {
      return enqueue((data) => {
        const rows = schedulesFor(data, userId);
        if (rows.length >= MAX_SCHEDULES) throw new DepositUserError("Schedule limit reached.");
        const reference = cleanText(input.reference, "Reference", 40);
        if (rows.some((row) => labelKey(row.reference) === labelKey(reference))) {
          throw new DepositUserError("That reference is already in use.");
        }
        const stamp = nowIso();
        const schedule: Schedule = {
          id: randomUUID(),
          clientName: cleanText(input.clientName, "Client name", 200),
          projectTitle: cleanText(input.projectTitle, "Project title", 200),
          reference,
          currency: assertCurrency(input.currency),
          status: "draft",
          approvedAt: null,
          deposit: null,
          laterPayments: [],
          clientScript: null,
          changes: [],
          createdAt: stamp,
          updatedAt: stamp
        };
        rows.unshift(schedule);
        return schedule;
      }, true);
    },
    readSchedule(userId, scheduleId) {
      return enqueue((data) => toRecord(findSchedule(data, userId, scheduleId)), false);
    },
    recordDeposit(userId, input) {
      return enqueue((data) => {
        const schedule = findSchedule(data, userId, input.scheduleId);
        const amountMinor = assertMinor(input.amountMinor, "Deposit amount");
        const dueOn = assertDate(input.dueOn);
        const stamp = nowIso();
        if (!schedule.deposit) {
          if (schedule.status === "approved") throw new DepositUserError("A deposit is required before the schedule can be approved.");
          schedule.deposit = { amountMinor, dueOn, standing: "due", updatedAt: stamp };
        } else {
          assertDateMove(schedule.status, schedule.deposit.dueOn, dueOn);
          assertAmountWrite(schedule.status, schedule.deposit.amountMinor, amountMinor);
          const changed = schedule.deposit.amountMinor !== amountMinor || schedule.deposit.dueOn !== dueOn;
          schedule.deposit.amountMinor = amountMinor;
          schedule.deposit.dueOn = dueOn;
          if (changed && schedule.status === "draft") schedule.deposit.standing = "due";
          schedule.deposit.updatedAt = stamp;
        }
        schedule.updatedAt = stamp;
        return schedule.deposit;
      }, true);
    },
    addLaterPayment(userId, input) {
      return enqueue((data) => {
        const schedule = findSchedule(data, userId, input.scheduleId);
        assertNewLaterPayment(schedule.status);
        if (schedule.laterPayments.length >= MAX_LATER) throw new DepositUserError("Later payment limit reached.");
        const stamp = nowIso();
        const payment: LaterPayment = {
          id: randomUUID(),
          label: cleanText(input.label, "Payment label", 200),
          amountMinor: assertMinor(input.amountMinor, "Payment amount"),
          dueOn: assertDate(input.dueOn),
          createdAt: stamp,
          updatedAt: stamp
        };
        schedule.laterPayments.push(payment);
        schedule.updatedAt = stamp;
        return payment;
      }, true);
    },
    movePaymentDate(userId, input) {
      return enqueue((data) => {
        const schedule = findSchedule(data, userId, input.scheduleId);
        const dueOn = assertDate(input.dueOn);
        const stamp = nowIso();
        if (input.target === "deposit") {
          const deposit = requireDeposit(schedule, "its date can move");
          assertDateMove(schedule.status, deposit.dueOn, dueOn);
          deposit.dueOn = dueOn;
          deposit.updatedAt = stamp;
          schedule.updatedAt = stamp;
          return { target: "deposit" as const, paymentId: null, dueOn };
        }
        if (input.target !== "later") throw new DepositUserError("Say whether the date is the deposit or a later payment.");
        if (!input.paymentId) throw new DepositUserError("A later payment id is required.");
        const payment = findPayment(schedule, input.paymentId);
        assertDateMove(schedule.status, payment.dueOn, dueOn);
        payment.dueOn = dueOn;
        payment.updatedAt = stamp;
        schedule.updatedAt = stamp;
        return { target: "later" as const, paymentId: payment.id, dueOn };
      }, true);
    },
    waiveDeposit(userId, scheduleId) {
      return enqueue((data) => {
        const schedule = findSchedule(data, userId, scheduleId);
        const deposit = requireDeposit(schedule, "it can be waived");
        assertWaive(schedule.status, deposit.standing);
        const stamp = nowIso();
        deposit.standing = "waived";
        deposit.updatedAt = stamp;
        schedule.updatedAt = stamp;
        return deposit;
      }, true);
    },
    markDepositPaid(userId, scheduleId) {
      return enqueue((data) => {
        const schedule = findSchedule(data, userId, scheduleId);
        const deposit = requireDeposit(schedule, "it can be marked paid");
        assertMarkPaid(schedule.status, deposit.standing);
        const stamp = nowIso();
        deposit.standing = "paid";
        deposit.updatedAt = stamp;
        schedule.updatedAt = stamp;
        return deposit;
      }, true);
    },
    writeClientScript(userId, input) {
      return enqueue((data) => {
        const schedule = findSchedule(data, userId, input.scheduleId);
        const script = cleanText(input.script, "Client script", 2000);
        assertScriptWrite(schedule.status, schedule.clientScript, script);
        const stamp = nowIso();
        schedule.clientScript = script;
        schedule.updatedAt = stamp;
        return { clientScript: script };
      }, true);
    },
    commitSchedule(userId, scheduleId) {
      return enqueue((data) => {
        const schedule = findSchedule(data, userId, scheduleId);
        if (schedule.status === "approved") return toRecord(schedule);
        if (!schedule.deposit) throw new DepositUserError("A deposit is required before the schedule can be approved.");
        if (schedule.laterPayments.length === 0) throw new DepositUserError("A later payment date is required before the schedule can be approved.");
        if (!schedule.clientScript) throw new DepositUserError("Client wording is required before the schedule can be approved.");
        const stamp = nowIso();
        schedule.status = "approved";
        schedule.approvedAt = stamp;
        schedule.updatedAt = stamp;
        return toRecord(schedule);
      }, true);
    },
    suggestScheduleChange(userId, input) {
      return enqueue((data) => {
        const schedule = findSchedule(data, userId, input.scheduleId);
        if (schedule.status !== "approved") throw new DepositUserError("Approve the schedule before suggesting a change.");
        if (schedule.changes.length >= MAX_CHANGES) throw new DepositUserError("Schedule change limit reached.");
        const summaryText = cleanText(input.summary, "Summary", 1000);
        const change = blankChange(input.kind, summaryText);
        if (input.kind === "waive_deposit") {
          const deposit = requireDeposit(schedule, "it can be waived");
          if (deposit.standing !== "due") throw new DepositUserError("The deposit is not outstanding, so it cannot be waived.");
        } else if (input.kind === "mark_deposit_paid") {
          const deposit = requireDeposit(schedule, "it can be marked paid");
          if (deposit.standing !== "due") throw new DepositUserError("The deposit is not outstanding, so it cannot be marked paid.");
        } else if (input.kind === "move_payment_date") {
          const dueOn = assertDate(input.dueOn ?? "");
          if (input.target === "deposit") {
            const deposit = requireDeposit(schedule, "its date can move");
            if (dueOn === deposit.dueOn) throw new DepositUserError("That change does not move the payment date.");
            change.target = "deposit";
            change.dueOn = dueOn;
          } else if (input.target === "later") {
            if (!input.paymentId) throw new DepositUserError("A later payment id is required.");
            const payment = findPayment(schedule, input.paymentId);
            if (dueOn === payment.dueOn) throw new DepositUserError("That change does not move the payment date.");
            change.target = "later";
            change.paymentId = payment.id;
            change.dueOn = dueOn;
          } else {
            throw new DepositUserError("Say whether the date is the deposit or a later payment.");
          }
        } else if (input.kind === "revise_deposit") {
          const deposit = requireDeposit(schedule, "its amount can change");
          const amountMinor = assertMinor(input.amountMinor ?? Number.NaN, "Deposit amount");
          if (amountMinor === deposit.amountMinor) throw new DepositUserError("That change does not change the deposit amount.");
          change.amountMinor = amountMinor;
        } else if (input.kind === "add_later_payment") {
          if (schedule.laterPayments.length >= MAX_LATER) throw new DepositUserError("Later payment limit reached.");
          change.label = cleanText(input.label ?? "", "Payment label", 200);
          change.amountMinor = assertMinor(input.amountMinor ?? Number.NaN, "Payment amount");
          change.dueOn = assertDate(input.dueOn ?? "");
        } else if (input.kind === "revise_client_script") {
          const script = cleanText(input.script ?? "", "Client script", 2000);
          if (script === schedule.clientScript) throw new DepositUserError("That change does not change what the assistant may tell the client.");
          change.script = script;
        } else {
          throw new DepositUserError("Unknown schedule change.");
        }
        schedule.changes.unshift(change);
        schedule.updatedAt = change.createdAt;
        return change;
      }, true);
    },
    acceptScheduleChange(userId, scheduleId, changeId) {
      return enqueue((data) => {
        const schedule = findSchedule(data, userId, scheduleId);
        const change = schedule.changes.find((row) => row.id === changeId);
        if (!change) throw new DepositUserError("Schedule change not found");
        if (change.applied) return toRecord(schedule);
        if (schedule.status !== "approved") throw new DepositUserError("Approve the schedule before suggesting a change.");
        const stamp = nowIso();
        if (change.kind === "waive_deposit") {
          const deposit = requireDeposit(schedule, "it can be waived");
          if (deposit.standing !== "due") throw new DepositUserError("The deposit is not outstanding, so it cannot be waived.");
          deposit.standing = "waived";
          deposit.updatedAt = stamp;
        } else if (change.kind === "mark_deposit_paid") {
          const deposit = requireDeposit(schedule, "it can be marked paid");
          if (deposit.standing !== "due") throw new DepositUserError("The deposit is not outstanding, so it cannot be marked paid.");
          deposit.standing = "paid";
          deposit.updatedAt = stamp;
        } else if (change.kind === "move_payment_date") {
          if (!change.dueOn || !change.target) throw new DepositUserError("Payment date must be a calendar date.");
          if (change.target === "deposit") {
            const deposit = requireDeposit(schedule, "its date can move");
            deposit.dueOn = change.dueOn;
            deposit.updatedAt = stamp;
          } else {
            if (!change.paymentId) throw new DepositUserError("Payment not found");
            const payment = findPayment(schedule, change.paymentId);
            payment.dueOn = change.dueOn;
            payment.updatedAt = stamp;
          }
        } else if (change.kind === "revise_deposit") {
          const deposit = requireDeposit(schedule, "its amount can change");
          if (change.amountMinor === null) throw new DepositUserError("Deposit amount must be a whole number of minor units from 1 to 100000000.");
          deposit.amountMinor = change.amountMinor;
          deposit.updatedAt = stamp;
        } else if (change.kind === "add_later_payment") {
          if (!change.label || change.amountMinor === null || !change.dueOn) {
            throw new DepositUserError("That later payment could not be added.");
          }
          if (schedule.laterPayments.length >= MAX_LATER) throw new DepositUserError("Later payment limit reached.");
          schedule.laterPayments.push({
            id: randomUUID(),
            label: change.label,
            amountMinor: change.amountMinor,
            dueOn: change.dueOn,
            createdAt: stamp,
            updatedAt: stamp
          });
        } else if (change.kind === "revise_client_script") {
          if (!change.script) throw new DepositUserError("Client script must be 1–2000 characters.");
          schedule.clientScript = change.script;
        } else {
          throw new DepositUserError("Unknown schedule change.");
        }
        change.status = "approved";
        change.applied = true;
        change.approvedAt = stamp;
        schedule.updatedAt = stamp;
        return toRecord(schedule);
      }, true);
    },
    addSupportRequest(input) {
      return enqueue((data) => {
        const request: SupportRequest = {
          id: randomUUID(),
          email: input.email,
          message: input.message,
          createdAt: nowIso()
        };
        data.supportRequests.push(request);
        if (data.supportRequests.length > MAX_SUPPORT) data.supportRequests.splice(0, data.supportRequests.length - MAX_SUPPORT);
        return { id: request.id };
      }, true);
    }
  };
}

export function isDepositRefusal(error: unknown): error is DepositRefusal {
  return error instanceof DepositRefusal;
}
