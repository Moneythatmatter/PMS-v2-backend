import { FloorPlanService } from "../../services/food-beverages/floor-plan.service.js";
import { fromError, ok } from "../../utils/response.js";
export async function listFloorPlan(req, res) {
    try {
        const outletId = req.query.outletId;
        const rows = await FloorPlanService.listFloorPlan(outletId);
        return ok(res, rows);
    }
    catch (e) {
        return fromError(res, e);
    }
}
export async function getFloorPlanTable(req, res) {
    try {
        const row = await FloorPlanService.getTableFloorPlan(String(req.params.id));
        return ok(res, row);
    }
    catch (e) {
        return fromError(res, e);
    }
}
//# sourceMappingURL=floor-plan.js.map