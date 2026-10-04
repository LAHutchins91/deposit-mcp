import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRO_REQUIRED, SIGN_IN_REQUIRED } from "../src/access.js";
import { createFileDepositStore, type DepositStore } from "../src/deposit-store.js";
import { DEPOSIT_TOOL_NAMES, createDepositMcpServer } from "../src/deposit-tools.js";

async function connect(options: { userId: string; entitled: boolean; store: DepositStore }) {
  const client = new Client({ name: "deposit-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createDepositMcpServer(options);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("deposit tools", () => {
  it("lists the Deposit tools", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "deposit-"));
    const client = await connect({ userId: "", entitled: false, store: createFileDepositStore(path.join(dir, "deposit.json")) });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...DEPOSIT_TOOL_NAMES].sort());
    const blob = listed.tools.map((tool) => `${tool.name} ${tool.description ?? ""}`).join("\n");
    expect(blob).not.toMatch(/\$\d/);
    expect(blob.toLowerCase()).not.toContain("dollar");
  });

  it("refuses tool calls without sign-in or an active trial", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "deposit-"));
    const saved = createFileDepositStore(path.join(dir, "deposit.json"));
    const anonymous = await connect({ userId: "", entitled: false, store: saved });
    const signedOut = await anonymous.callTool({ name: "list_schedules", arguments: {} });
    expect(signedOut.isError).toBe(true);
    expect(textOf(signedOut)).toContain(SIGN_IN_REQUIRED);

    const unpaid = await connect({ userId: "user-1", entitled: false, store: saved });
    const blocked = await unpaid.callTool({ name: "list_schedules", arguments: {} });
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toContain(PRO_REQUIRED);
  });

  it("refuses a waiver, a paid mark, and a moved date unless the change is accepted", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "deposit-"));
    const saved = createFileDepositStore(path.join(dir, "deposit.json"));
    const client = await connect({ userId: "user-1", entitled: true, store: saved });
    const created = await client.callTool({
      name: "start_schedule",
      arguments: { clientName: "Northwind", projectTitle: "Spring site", reference: "DEP-104", currency: "USD" }
    });
    const scheduleId = JSON.parse(textOf(created)).schedule.id as string;
    await client.callTool({
      name: "record_deposit",
      arguments: { scheduleId, amountMinor: 50000, dueOn: "2026-04-01" }
    });
    const placed = await client.callTool({
      name: "add_later_payment",
      arguments: { scheduleId, label: "Balance", amountMinor: 150000, dueOn: "2026-05-15" }
    });
    const paymentId = JSON.parse(textOf(placed)).id as string;
    await client.callTool({
      name: "write_client_script",
      arguments: { scheduleId, script: "The deposit is due on April 1 and the balance is due on May 15." }
    });
    await client.callTool({ name: "commit_schedule", arguments: { scheduleId, confirmed: true } });

    const waived = await client.callTool({ name: "waive_deposit", arguments: { scheduleId } });
    expect(waived.isError).toBe(true);
    expect(textOf(waived)).toContain("Refused:");
    expect(textOf(waived)).toContain("waiv");

    const paid = await client.callTool({ name: "mark_deposit_paid", arguments: { scheduleId } });
    expect(paid.isError).toBe(true);
    expect(textOf(paid)).toContain("paid");

    const later = await client.callTool({
      name: "move_payment_date",
      arguments: { scheduleId, target: "later", paymentId, dueOn: "2026-08-01" }
    });
    expect(later.isError).toBe(true);
    expect(textOf(later)).toContain("payment date");

    const suggestion = await client.callTool({
      name: "suggest_schedule_change",
      arguments: {
        scheduleId,
        kind: "move_payment_date",
        summary: "Freelancer approved a later balance date.",
        target: "later",
        paymentId,
        dueOn: "2026-08-01"
      }
    });
    const changeId = JSON.parse(textOf(suggestion)).id as string;
    const pending = await client.callTool({ name: "read_schedule", arguments: { scheduleId } });
    expect(JSON.parse(textOf(pending)).laterPayments[0].dueOn).toBe("2026-05-15");
    expect(JSON.parse(textOf(pending)).deposit.standing).toBe("due");
    expect(textOf(pending)).toContain("Tell the client");

    const applied = await client.callTool({
      name: "accept_schedule_change",
      arguments: { scheduleId, changeId, confirmed: true }
    });
    expect(JSON.parse(textOf(applied)).laterPayments[0].dueOn).toBe("2026-08-01");
    expect(JSON.parse(textOf(applied)).deposit.standing).toBe("due");
    expect(JSON.parse(textOf(applied)).deposit.amountMinor).toBe(50000);
  });
});
