import { test } from "node:test";
import assert from "node:assert/strict";
import { fromAPIContract, toAPIContract } from "../../src/lib/api-contract.ts";
import type { APIModel } from "../../src/lib/backend/contract";

test("REST conversion handles nested schedules, nulls, dates and paginated envelopes", () => {
  const wire = {
    items: [
      {
        created_at: "2026-10-19T08:00:00.000Z",
        schedule: { break_start: "12:00", break_end: "13:00", days: [1, 2] },
        email: null,
      },
    ],
    next_cursor: "opaque_value",
    total: 1005,
  };
  const ui = fromAPIContract<{
    items: {
      createdAt: string;
      schedule: { breakStart: string; breakEnd: string; days: number[] };
      email: null;
    }[];
    nextCursor: string;
    total: number;
  }>(wire);
  assert.equal(ui.items[0].schedule.breakStart, "12:00");
  assert.equal(ui.nextCursor, "opaque_value");
  assert.deepEqual(toAPIContract(ui), wire);
  assert.deepEqual(
    toAPIContract({ startsAt: new Date("2026-10-19T08:00:00Z") }),
    { starts_at: "2026-10-19T08:00:00.000Z" },
  );
});

test("generated wire models remain assignable to the converted REST contract", () => {
  const customer = {
    id: "id",
    workspaceId: "workspace",
    name: "Jane",
    email: null,
    phone: null,
    createdAt: "2026-10-19T08:00:00Z",
    appointmentCount: 1005,
  } satisfies APIModel<"Customer">;
  assert.deepEqual(fromAPIContract(toAPIContract(customer)), customer);
});

test("opaque dictionary paths preserve caller-owned keys and values", () => {
  const input = {
    workspaceId: "w",
    metadata: { Customer_ID: { raw_key: 1 }, untouchedKey: 2 },
  };
  const wire = toAPIContract(input, { opaquePaths: ["metadata"] });
  assert.deepEqual(wire, { workspace_id: "w", metadata: input.metadata });
  assert.deepEqual(fromAPIContract(wire, { opaquePaths: ["metadata"] }), input);
});
