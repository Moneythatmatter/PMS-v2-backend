import { Router } from "express";
import * as portal from "../controllers/front-office/guest-portal.js";
import * as tablePortal from "../controllers/food-beverages/guest-order-requests.js";

/** Public, unauthenticated routes for the in-room QR guest portal. Every call is verified by the signed room token. */
const router = Router();

router.get("/rooms/:roomId", portal.getContext);
router.get("/rooms/:roomId/menu", portal.getMenu);
router.post("/rooms/:roomId/food-orders", portal.postFoodOrder);
router.post("/rooms/:roomId/cleaning", portal.postCleaning);
router.post("/rooms/:roomId/laundry", portal.postLaundry);

router.get("/tables/:tableId", tablePortal.getTableContext);
router.get("/tables/:tableId/menu", tablePortal.getTableMenu);
router.get("/tables/:tableId/requests", tablePortal.getTableRequestStatuses);
router.post("/tables/:tableId/requests", tablePortal.submitTableRequest);

export default router;
