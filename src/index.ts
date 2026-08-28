import "dotenv/config";
import cors from "cors";
import express from "express";
import { config } from "./config/index.js";
import { mountApiDocs } from "./docs/index.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import authRoutes from "./routes/auth.js";
import frontOfficeRoutes from "./routes/front-office.js";
import foodBeveragesRoutes from "./routes/food-beverages.js";
import housekeepingRoutes from "./routes/housekeeping.js";
import purchaseStoresRoutes from "./routes/purchase-stores.js";
import transactionsRoutes from "./routes/transactions.js";

const app = express();
const PORT = config.port;

app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.get("/", (_req, res) => {
  res.json({
    message: "PMS API is running",
    version: "1.0.0",
    docs: "/api-docs",
    openapi: "/api-docs.json",
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

mountApiDocs(app);

app.use("/api/auth", authRoutes);
app.use("/api/front-office", frontOfficeRoutes);
app.use("/api/food-beverages", foodBeveragesRoutes);
app.use("/api/housekeeping", housekeepingRoutes);
app.use("/api/purchase-stores", purchaseStoresRoutes);
app.use("/api", transactionsRoutes);

app.use(errorHandler);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`API docs     → http://localhost:${PORT}/api-docs`);
  console.log(`OpenAPI JSON → http://localhost:${PORT}/api-docs.json`);
  console.log("Request logging enabled — API hits tagged by module:\n");
  console.log("  [FO]   /api/front-office");
  console.log("  [FB]   /api/food-beverages");
  console.log("  [HK]   /api/housekeeping");
  console.log("  [PS]   /api/purchase-stores");
  console.log("  [TXN]  /api/transactions\n");
});
