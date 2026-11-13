import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { attachRequestContext } from "../middleware/request-context.js";
import * as tenants from "../controllers/saas/tenants.js";

const router = Router();

router.use(requireAuth);
router.use(attachRequestContext);

router.get("/tenants", tenants.listTenants);
router.post("/tenants", tenants.createTenant);
router.patch("/tenants/:id/status", tenants.updateTenantStatus);

export default router;
