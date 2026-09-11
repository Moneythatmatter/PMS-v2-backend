import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEffectiveLeaveFromClassifications } from "./leave-effective-days.service.js";
import { leaveTypeCodeToBucket } from "./leave-balance.service.js";
describe("buildEffectiveLeaveFromClassifications", () => {
    it("TEST 1: all working days 10-12 consumes 3", () => {
        const dates = ["2026-09-10", "2026-09-11", "2026-09-12"];
        const map = new Map(dates.map((d) => [d, { dayType: "WORKING_DAY", holidayId: null }]));
        const result = buildEffectiveLeaveFromClassifications(dates, map);
        assert.equal(result.effectiveDays, 3);
        assert.deepEqual(result.eligibleDates, dates);
        assert.equal(result.excluded.length, 0);
    });
    it("TEST 2: 11 is holiday consumes 2", () => {
        const dates = ["2026-09-10", "2026-09-11", "2026-09-12"];
        const map = new Map([
            ["2026-09-10", { dayType: "WORKING_DAY", holidayId: null }],
            ["2026-09-11", { dayType: "HOLIDAY", holidayId: "H-001" }],
            ["2026-09-12", { dayType: "WORKING_DAY", holidayId: null }],
        ]);
        const result = buildEffectiveLeaveFromClassifications(dates, map);
        assert.equal(result.effectiveDays, 2);
        assert.deepEqual(result.eligibleDates, ["2026-09-10", "2026-09-12"]);
        assert.equal(result.excluded.length, 1);
        assert.equal(result.excluded[0].reason, "HOLIDAY");
    });
    it("TEST 3: 11 is weekly off consumes 2", () => {
        const dates = ["2026-09-10", "2026-09-11", "2026-09-12"];
        const map = new Map([
            ["2026-09-10", { dayType: "WORKING_DAY", holidayId: null }],
            ["2026-09-11", { dayType: "WEEKLY_OFF", holidayId: null }],
            ["2026-09-12", { dayType: "WORKING_DAY", holidayId: null }],
        ]);
        const result = buildEffectiveLeaveFromClassifications(dates, map);
        assert.equal(result.effectiveDays, 2);
        assert.deepEqual(result.eligibleDates, ["2026-09-10", "2026-09-12"]);
    });
    it("TEST 8: reduce to 10-11 with 11 holiday consumes 1", () => {
        const dates = ["2026-09-10", "2026-09-11"];
        const map = new Map([
            ["2026-09-10", { dayType: "WORKING_DAY", holidayId: null }],
            ["2026-09-11", { dayType: "HOLIDAY", holidayId: "H-001" }],
        ]);
        const result = buildEffectiveLeaveFromClassifications(dates, map);
        assert.equal(result.effectiveDays, 1);
        assert.deepEqual(result.eligibleDates, ["2026-09-10"]);
    });
});
describe("resolveWorkingDayAttendanceStatus", () => {
    it("future cancelled leave day stays PENDING until cutoff", async () => {
        const { resolveWorkingDayAttendanceStatus } = await import("../attendance/attendance.service.js");
        const result = resolveWorkingDayAttendanceStatus({
            hasPunch: false,
            cutoffPassed: false,
            approvedLeaveId: null,
        });
        assert.equal(result.attendanceStatus, "PENDING");
        assert.equal(result.leaveRequestId, null);
    });
    it("past cancelled leave day with cutoff passed becomes ABSENT", async () => {
        const { resolveWorkingDayAttendanceStatus } = await import("../attendance/attendance.service.js");
        const result = resolveWorkingDayAttendanceStatus({
            hasPunch: false,
            cutoffPassed: true,
            approvedLeaveId: null,
        });
        assert.equal(result.attendanceStatus, "ABSENT");
    });
    it("punch on cancelled leave day becomes PRESENT", async () => {
        const { resolveWorkingDayAttendanceStatus } = await import("../attendance/attendance.service.js");
        const result = resolveWorkingDayAttendanceStatus({
            hasPunch: true,
            cutoffPassed: false,
            approvedLeaveId: null,
        });
        assert.equal(result.attendanceStatus, "PRESENT");
    });
});
describe("leaveTypeCodeToBucket", () => {
    it("maps Shaw hotel leave codes", () => {
        assert.equal(leaveTypeCodeToBucket("LV-CL"), "casual");
        assert.equal(leaveTypeCodeToBucket("LV-SL"), "sick");
        assert.equal(leaveTypeCodeToBucket("LV-EL"), "earned");
    });
});
//# sourceMappingURL=leave-integration.test.js.map