import type { Request, Response } from "express";
import { hkModel } from "../../models/housekeeping/index.js";
import { fail, fromError, ok } from "../../utils/response.js";

type Room = Record<string, unknown>;
type Laundry = Record<string, unknown>;
type Inventory = Record<string, unknown>;
type Staff = Record<string, unknown>;
type Damage = Record<string, unknown>;
type History = Record<string, unknown>;

const REPORT_TYPES = [
  "room-status",
  "cleaning-productivity",
  "inspection",
  "laundry",
  "inventory",
  "damage",
  "staff-performance",
  "public-area",
] as const;

export async function getReport(req: Request, res: Response) {
  try {
    const type = String(req.params.type);
    if (!REPORT_TYPES.includes(type as (typeof REPORT_TYPES)[number])) {
      return fail(res, `Unknown report type: ${type}`, 404);
    }

    const [rooms, laundry, inventory, staff, damage, history, publicAreas] =
      await Promise.all([
        hkModel.list<Room>(hkModel.tables.rooms),
        hkModel.list<Laundry>(hkModel.tables.laundryJobs),
        hkModel.list<Inventory>(hkModel.tables.inventory),
        hkModel.list<Staff>(hkModel.tables.staff),
        hkModel.list<Damage>(hkModel.tables.damageReports),
        hkModel.list<History>(hkModel.tables.history),
        hkModel.list(hkModel.tables.publicAreas),
      ]);

    const titleMap: Record<(typeof REPORT_TYPES)[number], string> = {
      "room-status": "Room Status Summary",
      "cleaning-productivity": "Cleaning Productivity",
      inspection: "Inspection Report",
      laundry: "Laundry Report",
      inventory: "HK Inventory Report",
      damage: "Damage & Cost Report",
      "staff-performance": "Staff Performance",
      "public-area": "Public Area Status",
    };

    const rows = (() => {
      switch (type) {
        case "room-status": {
          const byStatus: Record<string, number> = {};
          for (const r of rooms) {
            const s = String(r.status ?? "Unknown");
            byStatus[s] = (byStatus[s] ?? 0) + 1;
          }
          return Object.entries(byStatus).map(([status, count], i) => ({
            id: `RS-${i}`,
            status,
            count,
            pct: rooms.length
              ? Math.round((count / rooms.length) * 100)
              : 0,
          }));
        }
        case "cleaning-productivity": {
          const cleaners = staff.filter((s) => s.role === "Housekeeper");
          return cleaners.map((s) => ({
            id: s.id,
            name: s.name,
            floor: s.currentFloor ?? "—",
            activeTasks: Number(s.activeTaskCount ?? 0),
            completedToday: Number(s.completedToday ?? 0),
            workStatus: s.workStatus ?? "Available",
          }));
        }
        case "inspection": {
          const inspected = rooms.flatMap((r) => {
            const hist = Array.isArray(r.inspectionHistory)
              ? (r.inspectionHistory as Record<string, unknown>[])
              : [];
            return hist.map((h) => ({
              id: h.id,
              room: r.roomNo ?? r.id,
              inspector: h.inspector,
              result: h.result,
              qualityScore: h.qualityScore,
              date: h.date,
              remarks: h.remarks,
            }));
          });
          return inspected.slice(0, 50);
        }
        case "laundry":
          return laundry.map((j) => ({
            id: j.id,
            type: j.type,
            item: j.item,
            quantity: j.quantity,
            status: j.status,
            charges: Number(j.charges ?? 0),
            room: j.room ?? "—",
          }));
        case "inventory":
          return inventory.map((i) => ({
            id: i.id,
            name: i.name,
            category: i.category,
            available: Number(i.available ?? 0),
            parStock: Number(i.parStock ?? 0),
            belowPar:
              Number(i.available ?? 0) < Number(i.parStock ?? 0)
                ? "Yes"
                : "No",
            unit: i.unit,
          }));
        case "damage":
          return damage.map((d) => ({
            id: d.id,
            room: d.room,
            damageType: d.damageType,
            estimatedCost: Number(d.estimatedCost ?? 0),
            status: d.status,
            reportedBy: d.reportedBy,
            reportedAt: d.reportedAt,
          }));
        case "staff-performance":
          return staff.map((s) => ({
            id: s.id,
            name: s.name,
            role: s.role,
            shift: s.activeShift,
            completedToday: Number(s.completedToday ?? 0),
            activeJobs: Number(s.activeJobs ?? s.activeTaskCount ?? 0),
            status: s.status,
          }));
        case "public-area":
          return publicAreas.map((a) => {
            const area = a as Record<string, unknown>;
            return {
              id: area.id,
              name: area.name,
              category: area.category,
              status: area.status,
              priority: area.priority,
              assignedStaff: area.assignedStaff,
              lastCleaned: area.lastCleaned,
            };
          });
        default:
          return [];
      }
    })();

    const summary: Record<string, unknown> = {
      totalRooms: rooms.length,
      dirtyRooms: rooms.filter((r) =>
        ["Dirty", "Vacant Dirty", "Occupied Dirty"].includes(
          String(r.hkStatus ?? r.status),
        ),
      ).length,
      openLaundry: laundry.filter((j) => j.status !== "Delivered").length,
      belowParItems: inventory.filter(
        (i) => Number(i.available ?? 0) < Number(i.parStock ?? 0),
      ).length,
      openDamage: damage.filter((d) =>
        ["Reported", "Approved"].includes(String(d.status)),
      ).length,
      historyEvents: history.length,
    };

    return ok(res, {
      type,
      title: titleMap[type as (typeof REPORT_TYPES)[number]],
      summary,
      rows,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return fromError(res, e);
  }
}
