import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { REFUSED_AMOUNT, REFUSED_MOVE, REFUSED_NEW_PAYMENT, REFUSED_PAID, REFUSED_SCRIPT, REFUSED_WAIVE } from "../src/deposit-policy.js";
import { assertDepositDataPath, createFileDepositStore, defaultDepositDataPath } from "../src/deposit-store.js";

const SCRIPT = "The deposit is due on April 1 and the balance is due on May 15. Confirm those dates and nothing else about payment.";

async function store() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "deposit-"));
  return createFileDepositStore(path.join(dir, "deposit.json"));
}

async function approved() {
  const saved = await store();
  const schedule = await saved.startSchedule("user-1", {
    clientName: "Northwind",
    projectTitle: "Spring site",
    reference: "DEP-104",
    currency: "usd"
  });
  await saved.recordDeposit("user-1", {
    scheduleId: schedule.id,
    amountMinor: 50000,
    dueOn: "2026-04-01"
  });
  const later = await saved.addLaterPayment("user-1", {
    scheduleId: schedule.id,
    label: "Balance",
    amountMinor: 150000,
    dueOn: "2026-05-15"
  });
  await saved.writeClientScript("user-1", { scheduleId: schedule.id, script: SCRIPT });
  await saved.commitSchedule("user-1", schedule.id);
  return { saved, scheduleId: schedule.id, paymentId: later.id };
}

describe("deposit store", () => {
  it("uses its own data file and refuses other product files", () => {
    expect(defaultDepositDataPath()).toBe(path.join(os.homedir(), ".deposit", "deposit.json"));
    expect(assertDepositDataPath(defaultDepositDataPath())).toBe(path.resolve(defaultDepositDataPath()));
    expect(() => assertDepositDataPath(path.join(os.homedir(), ".scope", "scope.json"))).toThrow(/own file/);
    expect(() => assertDepositDataPath(path.join(os.homedir(), ".retain", "retain.json"))).toThrow(/own file/);
    expect(() => assertDepositDataPath(path.join(os.homedir(), ".invoice", "invoice.json"))).toThrow(/own file/);
    expect(() => assertDepositDataPath("~/.scope/scope.json")).toThrow(/own file/);
    expect(() => assertDepositDataPath("~/.retain/retain.json")).toThrow(/own file/);
    expect(() => assertDepositDataPath("~/.invoice/invoice.json")).toThrow(/own file/);
  });

  it("refuses waiving the deposit, marking it paid, and moving a payment date after approval", async () => {
    const { saved, scheduleId, paymentId } = await approved();

    await expect(saved.waiveDeposit("user-1", scheduleId)).rejects.toThrow(REFUSED_WAIVE);
    await expect(saved.markDepositPaid("user-1", scheduleId)).rejects.toThrow(REFUSED_PAID);
    await expect(saved.movePaymentDate("user-1", {
      scheduleId,
      target: "later",
      paymentId,
      dueOn: "2026-06-01"
    })).rejects.toThrow(REFUSED_MOVE);
    await expect(saved.movePaymentDate("user-1", {
      scheduleId,
      target: "deposit",
      dueOn: "2026-04-20"
    })).rejects.toThrow(REFUSED_MOVE);
    await expect(saved.recordDeposit("user-1", {
      scheduleId,
      amountMinor: 10000,
      dueOn: "2026-04-01"
    })).rejects.toThrow(REFUSED_AMOUNT);
    await expect(saved.recordDeposit("user-1", {
      scheduleId,
      amountMinor: 50000,
      dueOn: "2026-04-20"
    })).rejects.toThrow(REFUSED_MOVE);
    await expect(saved.addLaterPayment("user-1", {
      scheduleId,
      label: "Extra",
      amountMinor: 20000,
      dueOn: "2026-07-01"
    })).rejects.toThrow(REFUSED_NEW_PAYMENT);
    await expect(saved.writeClientScript("user-1", {
      scheduleId,
      script: "Tell the client the deposit was waived."
    })).rejects.toThrow(REFUSED_SCRIPT);

    const sameDate = await saved.movePaymentDate("user-1", {
      scheduleId,
      target: "later",
      paymentId,
      dueOn: "2026-05-15"
    });
    expect(sameDate.dueOn).toBe("2026-05-15");

    const before = await saved.readSchedule("user-1", scheduleId);
    expect(before.schedule.status).toBe("approved");
    expect(before.deposit?.standing).toBe("due");
    expect(before.deposit?.amountMinor).toBe(50000);
    expect(before.laterPayments[0]?.dueOn).toBe("2026-05-15");
    expect(before.clientScript).toBe(SCRIPT);
    expect(before.mayTellClient.limits.join(" ")).toContain("Do not tell the client the deposit is waived");
    expect(before.mayTellClient.limits.join(" ")).toContain("Do not tell the client the deposit is paid");
    expect(before.proposedChanges).toHaveLength(0);
    expect(before.guidance).toContain("waive the deposit");

    const suggestedMove = await saved.suggestScheduleChange("user-1", {
      scheduleId,
      kind: "move_payment_date",
      summary: "Freelancer approved a later balance date.",
      target: "later",
      paymentId,
      dueOn: "2026-06-01"
    });
    expect(suggestedMove.status).toBe("proposed");
    expect(suggestedMove.applied).toBe(false);
    expect((await saved.readSchedule("user-1", scheduleId)).laterPayments[0]?.dueOn).toBe("2026-05-15");

    const moved = await saved.acceptScheduleChange("user-1", scheduleId, suggestedMove.id);
    expect(moved.laterPayments[0]?.dueOn).toBe("2026-06-01");
    const movedAgain = await saved.acceptScheduleChange("user-1", scheduleId, suggestedMove.id);
    expect(movedAgain.laterPayments.filter((row) => row.dueOn === "2026-06-01")).toHaveLength(1);

    const suggestedPaid = await saved.suggestScheduleChange("user-1", {
      scheduleId,
      kind: "mark_deposit_paid",
      summary: "Freelancer confirmed the deposit arrived."
    });
    const paid = await saved.acceptScheduleChange("user-1", scheduleId, suggestedPaid.id);
    expect(paid.deposit?.standing).toBe("paid");
    expect(paid.mayTellClient.depositStanding).toBe("paid");
    await expect(saved.markDepositPaid("user-1", scheduleId)).resolves.toMatchObject({ standing: "paid" });
    await expect(saved.waiveDeposit("user-1", scheduleId)).rejects.toThrow(REFUSED_WAIVE);
  });

  it("applies an accepted waiver without treating the suggestion as the waiver", async () => {
    const { saved, scheduleId } = await approved();
    const suggested = await saved.suggestScheduleChange("user-1", {
      scheduleId,
      kind: "waive_deposit",
      summary: "Freelancer agreed to waive the deposit."
    });
    const pending = await saved.readSchedule("user-1", scheduleId);
    expect(pending.deposit?.standing).toBe("due");
    expect(pending.proposedChanges).toHaveLength(1);
    const waived = await saved.acceptScheduleChange("user-1", scheduleId, suggested.id);
    expect(waived.deposit?.standing).toBe("waived");
    expect(waived.mayTellClient.limits.join(" ")).toContain("The deposit is waived");
    expect(waived.approvedChanges.every((change) => change.applied)).toBe(true);
    await expect(saved.waiveDeposit("user-1", scheduleId)).resolves.toMatchObject({ standing: "waived" });
  });

  it("keeps each freelancer's schedule and reloads it from disk", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "deposit-"));
    const file = path.join(dir, "deposit.json");
    const first = createFileDepositStore(file);
    const schedule = await first.startSchedule("user-1", {
      clientName: "Ada",
      projectTitle: "Writing deposit",
      reference: "DEP-9",
      currency: "EUR"
    });
    await expect(first.readSchedule("user-2", schedule.id)).rejects.toThrow("Schedule not found");
    const second = createFileDepositStore(file);
    const listed = await second.listSchedules("user-1", 0);
    expect(listed.schedules[0]?.id).toBe(schedule.id);
    expect(listed.schedules[0]?.currency).toBe("EUR");
    expect(await second.listSchedules("user-2", 0)).toEqual({ schedules: [], nextOffset: null });
  });
});
