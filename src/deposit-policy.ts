export class DepositRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepositRefusal";
  }
}

export class DepositUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepositUserError";
  }
}

export type ScheduleStatus = "draft" | "approved";

export type DepositStanding = "due" | "paid" | "waived";

export type PaymentTarget = "deposit" | "later";

export type ChangeKind =
  | "waive_deposit"
  | "mark_deposit_paid"
  | "move_payment_date"
  | "revise_deposit"
  | "add_later_payment"
  | "revise_client_script";

export const REFUSED_WAIVE =
  "Refused: waiving the deposit is not allowed after the schedule is approved. Suggest a waive_deposit change and accept that change. waive_deposit will not waive it.";

export const REFUSED_PAID =
  "Refused: marking the deposit paid is not allowed after the schedule is approved. Suggest a mark_deposit_paid change and accept that change. mark_deposit_paid will not mark it paid.";

export const REFUSED_MOVE =
  "Refused: the payment date stays as approved. Suggest a move_payment_date change and accept that change. move_payment_date will not move it.";

export const REFUSED_AMOUNT =
  "Refused: the approved deposit amount stays as it was approved. Suggest a revise_deposit change and accept that change. record_deposit will not change it.";

export const REFUSED_NEW_PAYMENT =
  "Refused: a new later payment is not allowed after the schedule is approved. Suggest an add_later_payment change and accept that change.";

export const REFUSED_SCRIPT =
  "Refused: what the assistant may tell the client stays as approved. Suggest a revise_client_script change and accept that change. write_client_script will not replace it.";

export const RECORD_GUIDANCE =
  "Answer only from this schedule. Tell the client only what clientScript and mayTellClient allow. Draft status means the schedule is not an approved commitment. Proposed schedule changes are not authorization. Do not waive the deposit, mark it paid, or move a payment date. waive_deposit, mark_deposit_paid, and move_payment_date refuse those changes after approval. Deposit and payment amounts are the freelancer's figures.";

export type LaterPaymentFact = {
  label: string;
  amountMinor: number;
  dueOn: string;
};

export type MayTellClient = {
  script: string | null;
  depositStanding: DepositStanding | "unrecorded";
  depositAmountMinor: number | null;
  depositDueOn: string | null;
  currency: string;
  laterPayments: LaterPaymentFact[];
  limits: string[];
};

export function labelKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function assertWaive(status: ScheduleStatus, standing: DepositStanding): void {
  if (status !== "approved") return;
  if (standing === "waived") return;
  throw new DepositRefusal(REFUSED_WAIVE);
}

export function assertMarkPaid(status: ScheduleStatus, standing: DepositStanding): void {
  if (status !== "approved") return;
  if (standing === "paid") return;
  throw new DepositRefusal(REFUSED_PAID);
}

export function assertDateMove(status: ScheduleStatus, current: string, next: string): void {
  if (status === "approved" && current !== next) throw new DepositRefusal(REFUSED_MOVE);
}

export function assertAmountWrite(status: ScheduleStatus, current: number, next: number): void {
  if (status === "approved" && current !== next) throw new DepositRefusal(REFUSED_AMOUNT);
}

export function assertNewLaterPayment(status: ScheduleStatus): void {
  if (status === "approved") throw new DepositRefusal(REFUSED_NEW_PAYMENT);
}

export function assertScriptWrite(status: ScheduleStatus, current: string | null, next: string): void {
  if (status === "approved" && current !== next) throw new DepositRefusal(REFUSED_SCRIPT);
}

export function buildMayTellClient(input: {
  status: ScheduleStatus;
  currency: string;
  deposit: { amountMinor: number; dueOn: string; standing: DepositStanding } | null;
  laterPayments: LaterPaymentFact[];
  clientScript: string | null;
}): MayTellClient {
  const limits = [
    "Tell the client only the client script and the facts in this record.",
    "Do not tell the client the deposit is waived unless depositStanding is waived.",
    "Do not tell the client the deposit is paid unless depositStanding is paid.",
    "Do not tell the client a payment date that is not in this record.",
    "Do not present a proposed schedule change as something the client was told."
  ];
  if (input.status !== "approved") {
    limits.push("This schedule is still a draft. Do not present it to the client as an approved commitment.");
  }
  if (input.deposit?.standing === "due") {
    limits.push("The deposit is still due. Do not tell the client it is waived or paid.");
  } else if (input.deposit?.standing === "paid") {
    limits.push("The deposit is paid. Do not tell the client it is still due or waived.");
  } else if (input.deposit?.standing === "waived") {
    limits.push("The deposit is waived. Do not tell the client it is still due or paid.");
  }
  return {
    script: input.clientScript,
    depositStanding: input.deposit?.standing ?? "unrecorded",
    depositAmountMinor: input.deposit?.amountMinor ?? null,
    depositDueOn: input.deposit?.dueOn ?? null,
    currency: input.currency,
    laterPayments: input.laterPayments.map((payment) => ({
      label: payment.label,
      amountMinor: payment.amountMinor,
      dueOn: payment.dueOn
    })),
    limits
  };
}
