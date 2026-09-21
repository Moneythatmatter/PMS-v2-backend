import type { Request, Response } from "express";
import { listRows } from "../../models/front-office/base.js";
import { mntTables } from "../../models/maintenance/index.js";
import { unpackMntDocument } from "../../utils/maintenance-docs.js";
import { fromError, ok } from "../../utils/response.js";

type StatusRow = { status?: string; priority?: string; isSafetyHazard?: boolean; roomBlockType?: string; nextDueDate?: string; location?: string; locationType?: string; woNumber?: string; technicianName?: string; issue?: string; hkHandoverStatus?: string; dueDate?: string; payload?: Record<string, unknown> };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function getDashboard(_req: Request, res: Response) {
  try {
    const [requestsRaw, workOrdersRaw, pmRaw] = await Promise.all([
      listRows<StatusRow>(mntTables.requests, { orderBy: "created_at", ascending: false }),
      listRows<StatusRow>(mntTables.workOrders, { orderBy: "created_at", ascending: false }),
      listRows<StatusRow>(mntTables.pmSchedules, { orderBy: "next_due_date", ascending: true }),
    ]);

    const requests = requestsRaw.map((r) => unpackMntDocument(r as Record<string, unknown>));
    const workOrders = workOrdersRaw.map((r) => unpackMntDocument(r as Record<string, unknown>));
    const pmSchedules = pmRaw.map((r) => unpackMntDocument(r as Record<string, unknown>));

    const openStatuses = new Set(["New", "Verification", "Verified", "Approved", "In Review"]);
    const openRequests = requests.filter((r) => openStatuses.has(String(r.status ?? "")));
    const activeWoStatuses = new Set(["New", "Assigned", "In Progress", "Awaiting Parts"]);
    const activeWorkOrders = workOrders.filter((w) => activeWoStatuses.has(String(w.status ?? "")));
    const critical = workOrders.filter(
      (w) =>
        activeWoStatuses.has(String(w.status ?? "")) &&
        (String(w.priority) === "Critical" || Boolean(w.isSafetyHazard)),
    );

    const today = todayIso();
    const pmDueToday = pmSchedules.filter((p) => {
      const due = String(p.nextDueDate ?? "");
      return due === today || String(p.status) === "Due" || String(p.status) === "Overdue";
    });

    const roomsUnder = workOrders.filter(
      (w) =>
        activeWoStatuses.has(String(w.status ?? "")) &&
        (w.roomBlockType === "OOO" || w.roomBlockType === "OOS") &&
        String(w.locationType ?? "") === "Guest Room",
    );

    const roomsUnderMaintenance = roomsUnder.map((w) => ({
      id: String(w.id ?? w.woNumber),
      roomNumber: String(w.location ?? "").replace(/^Room\s+/i, "").split(" ")[0] || String(w.location),
      floor: "",
      roomType: "",
      blockType: w.roomBlockType,
      reason: String(w.issue ?? ""),
      reportedAt: String(w.dueDate ?? today),
      expectedHandover: String(w.dueDate ?? today),
      technician: String(w.technicianName ?? ""),
      workOrderNo: String(w.woNumber ?? ""),
      hkHandoverStatus: w.hkHandoverStatus ?? "Under Repair",
    }));

    return ok(res, {
      stats: {
        openRequests: {
          total: openRequests.length,
          newCount: openRequests.filter((r) => r.status === "New").length,
          inReviewCount: openRequests.filter((r) =>
            ["Verification", "In Review", "Verified"].includes(String(r.status)),
          ).length,
        },
        activeWorkOrders: {
          total: activeWorkOrders.length,
          inProgress: activeWorkOrders.filter((w) => w.status === "In Progress").length,
          awaitingParts: activeWorkOrders.filter((w) => w.status === "Awaiting Parts").length,
        },
        criticalIssues: {
          total: critical.length,
          safetyHazardCount: critical.filter((w) => Boolean(w.isSafetyHazard)).length,
        },
        pmDueToday: {
          totalDue: pmDueToday.length,
          completed: 0,
          pending: pmDueToday.length,
        },
        roomsUnderMaintenance: {
          total: roomsUnderMaintenance.length,
          oooCount: roomsUnderMaintenance.filter((r) => r.blockType === "OOO").length,
          oosCount: roomsUnderMaintenance.filter((r) => r.blockType === "OOS").length,
        },
      },
      criticalIssues: critical.slice(0, 20),
      activeWorkOrders: activeWorkOrders.slice(0, 20),
      roomsUnderMaintenance,
      pmTasksToday: pmDueToday.slice(0, 20),
      recentRequests: openRequests.slice(0, 10),
    });
  } catch (e) {
    return fromError(res, e);
  }
}

/** Aggregate reports from live work orders / PM schedules. */
export async function getReports(_req: Request, res: Response) {
  try {
    const [workOrdersRaw, pmRaw] = await Promise.all([
      listRows(mntTables.workOrders, { orderBy: "created_at", ascending: false }),
      listRows(mntTables.pmSchedules, { orderBy: "next_due_date", ascending: true }),
    ]);
    const workOrders = workOrdersRaw.map((r) => unpackMntDocument(r as Record<string, unknown>));
    const pmSchedules = pmRaw.map((r) => unpackMntDocument(r as Record<string, unknown>));

    const turnaround = workOrders.map((w) => ({
      woNumber: w.woNumber,
      location: w.location,
      category: w.problemCategory || w.woType,
      priority: w.priority,
      status: w.status,
      technician: w.technicianName,
      dueDate: w.dueDate,
      totalCost: w.totalCost ?? 0,
    }));

    const pmCompliance = pmSchedules.map((p) => ({
      pmNumber: p.pmNumber,
      assetCode: p.assetCode,
      assetName: p.assetName,
      taskTitle: p.taskTitle,
      frequency: p.frequency,
      nextDueDate: p.nextDueDate,
      status: p.status,
      lastCompletedDate: p.lastCompletedDate,
    }));

    const roomDowntime = workOrders
      .filter((w) => w.roomBlockType === "OOO" || w.roomBlockType === "OOS")
      .map((w) => ({
        room: w.location,
        blockType: w.roomBlockType,
        workOrderNo: w.woNumber,
        reason: w.issue,
        status: w.status,
        technician: w.technicianName,
      }));

    const spareParts: Array<{
      partName: string;
      productCode: string;
      quantity: number;
      totalCost: number;
      woNumber: string;
    }> = [];
    for (const w of workOrders) {
      const parts = (w.partsUsed as Array<Record<string, unknown>> | undefined) ?? [];
      for (const p of parts) {
        spareParts.push({
          partName: String(p.partName ?? ""),
          productCode: String(p.productCode ?? ""),
          quantity: Number(p.quantity ?? 0),
          totalCost: Number(p.totalCost ?? 0),
          woNumber: String(w.woNumber ?? ""),
        });
      }
    }

    return ok(res, { turnaround, pmCompliance, roomDowntime, spareParts });
  } catch (e) {
    return fromError(res, e);
  }
}
