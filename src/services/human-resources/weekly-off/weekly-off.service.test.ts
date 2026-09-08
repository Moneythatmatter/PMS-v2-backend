import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignmentIncludesDay,
  assignmentMatchesWeekday,
  deriveDisplayStatus,
  isEffectiveOnDate,
  isExplicitlyDisabled,
  rangesOverlap,
  resolveWeeklyOffFromAssignments,
  type WeeklyOffAssignment,
} from "./weekly-off.service.js";

const baseAssignment = (overrides: Partial<WeeklyOffAssignment>): WeeklyOffAssignment => ({
  id: "WO-001",
  employeeId: "EMP-001",
  offType: "Fixed",
  days: ["Sunday"],
  effectiveFrom: "2026-09-01",
  effectiveTo: "2026-09-30",
  status: "Active",
  ...overrides,
});

describe("isEffectiveOnDate", () => {
  it("respects effective date range on target date", () => {
    assert.equal(isEffectiveOnDate("2026-09-01", "2026-09-30", "2026-09-13"), true);
    assert.equal(isEffectiveOnDate("2026-09-01", "2026-09-30", "2026-09-01"), true);
    assert.equal(isEffectiveOnDate("2026-09-01", "2026-09-30", "2026-09-30"), true);
    assert.equal(isEffectiveOnDate("2026-09-01", "2026-09-30", "2026-10-01"), false);
    assert.equal(isEffectiveOnDate("2026-09-01", "2026-09-30", "2026-08-31"), false);
  });

  it("treats null effective_to as open-ended", () => {
    assert.equal(isEffectiveOnDate("2026-09-01", null, "2027-01-01"), true);
  });
});

describe("deriveDisplayStatus (UI only)", () => {
  it("derives Upcoming / Active / Expired from today", () => {
    assert.equal(deriveDisplayStatus("2026-08-01", "2026-08-31", "2026-09-08"), "Expired");
    assert.equal(deriveDisplayStatus("2026-09-10", "2026-09-30", "2026-09-08"), "Upcoming");
    assert.equal(deriveDisplayStatus("2026-09-01", "2026-09-30", "2026-09-08"), "Active");
  });
});

describe("resolveWeeklyOffFromAssignments", () => {
  it("Sunday assigned resolves WEEKLY_OFF on Sunday", () => {
    const result = resolveWeeklyOffFromAssignments(
      [baseAssignment({})],
      "2026-09-13",
    );
    assert.equal(result.isWeeklyOff, true);
    assert.equal(result.day, "Sunday");
    assert.equal(result.assignmentId, "WO-001");
  });

  it("Monday does not resolve weekly off for Sunday assignment", () => {
    const result = resolveWeeklyOffFromAssignments(
      [baseAssignment({})],
      "2026-09-14",
    );
    assert.equal(result.isWeeklyOff, false);
  });

  it("ignores UI Expired label — historical date still resolves", () => {
    const result = resolveWeeklyOffFromAssignments(
      [baseAssignment({ effectiveFrom: "2026-08-01", effectiveTo: "2026-08-31", status: "Expired" })],
      "2026-08-16",
    );
    assert.equal(result.isWeeklyOff, true);
  });

  it("future assignment ignored before effective_from", () => {
    const result = resolveWeeklyOffFromAssignments(
      [baseAssignment({ effectiveFrom: "2026-10-01", effectiveTo: "2026-10-31" })],
      "2026-09-13",
    );
    assert.equal(result.isWeeklyOff, false);
  });

  it("expired-by-date assignment ignored for dates after effective_to", () => {
    const result = resolveWeeklyOffFromAssignments(
      [baseAssignment({ effectiveFrom: "2026-08-01", effectiveTo: "2026-08-31" })],
      "2026-09-13",
    );
    assert.equal(result.isWeeklyOff, false);
  });

  it("explicitly cancelled assignment is ignored even on matching date", () => {
    const result = resolveWeeklyOffFromAssignments(
      [baseAssignment({ status: "Cancelled" })],
      "2026-09-13",
    );
    assert.equal(result.isWeeklyOff, false);
  });

  it("explicitly inactive assignment is ignored on matching weekday", () => {
    const result = resolveWeeklyOffFromAssignments(
      [baseAssignment({ status: "Inactive", effectiveFrom: "2026-08-01", effectiveTo: "2026-08-31" })],
      "2026-08-16",
    );
    assert.equal(result.isWeeklyOff, false);
  });
});

describe("rangesOverlap", () => {
  it("non-overlapping ranges do not overlap", () => {
    assert.equal(
      rangesOverlap("2026-08-01", "2026-08-31", "2026-09-01", "2026-09-30"),
      false,
    );
  });

  it("partially overlapping ranges overlap", () => {
    assert.equal(
      rangesOverlap("2026-08-15", "2026-09-15", "2026-09-01", "2026-09-30"),
      true,
    );
  });

  it("handles nullable effective_to", () => {
    assert.equal(rangesOverlap("2026-09-01", null, "2026-12-01", "2026-12-31"), true);
  });
});

describe("assignmentIncludesDay", () => {
  it("matches day case-insensitively", () => {
    assert.equal(assignmentIncludesDay(baseAssignment({ days: ["Sunday"] }), "sunday"), true);
    assert.equal(assignmentIncludesDay(baseAssignment({ days: ["Sunday"] }), "Monday"), false);
  });
});

describe("assignmentMatchesWeekday", () => {
  it("matches weekday for a concrete date", () => {
    assert.equal(assignmentMatchesWeekday(baseAssignment({ days: ["Sunday"] }), "2026-09-13"), true);
    assert.equal(assignmentMatchesWeekday(baseAssignment({ days: ["Sunday"] }), "2026-09-14"), false);
  });
});

describe("isExplicitlyDisabled", () => {
  it("detects cancelled/disabled/inactive", () => {
    assert.equal(isExplicitlyDisabled("Cancelled"), true);
    assert.equal(isExplicitlyDisabled("Disabled"), true);
    assert.equal(isExplicitlyDisabled("Active"), false);
    assert.equal(isExplicitlyDisabled("Expired"), false);
  });
});
