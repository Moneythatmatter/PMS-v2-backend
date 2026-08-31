import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { attachRequestContext } from "../middleware/request-context.js";
import * as platform from "../controllers/platform/index.js";
const router = Router();
router.use(requireAuth);
router.use(attachRequestContext);
router.get("/properties", platform.listProperties);
router.post("/properties", platform.createProperty);
router.put("/properties/:id", platform.updateProperty);
router.get("/modules", platform.listModules);
router.get("/permissions/me", platform.myPermissions);
router.get("/users", platform.listUsers);
router.post("/users", platform.createUser);
router.put("/users/:id", platform.updateUser);
export default router;
//# sourceMappingURL=platform.js.map