import { Router } from "express";
import * as transactions from "../controllers/transactions.js";
const router = Router();
router.get("/transactions", transactions.listTransactions);
router.get("/transactions/:id", transactions.getTransaction);
router.post("/transactions", transactions.createTransaction);
router.patch("/transactions/:id", transactions.updateTransaction);
router.put("/transactions/:id", transactions.updateTransaction);
router.post("/transactions/front-office/payment", transactions.recordFrontOfficePayment);
router.post("/transactions/fnb/payment", transactions.recordFnbPayment);
router.post("/transactions/reservation/advance", transactions.recordReservationAdvance);
router.get("/folios", transactions.listFolios);
router.get("/folios/:id", transactions.getFolio);
router.post("/folios/ensure", transactions.ensureFolioForBooking);
export default router;
//# sourceMappingURL=transactions.js.map