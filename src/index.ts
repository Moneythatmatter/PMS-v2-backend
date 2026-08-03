import "dotenv/config";
import cors from "cors";
import express from "express";
import { config } from "./config/index.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import authRoutes from "./routes/auth.js";
import frontOfficeRoutes from "./routes/front-office.js";
import foodBeveragesRoutes from "./routes/food-beverages.js";
import housekeepingRoutes from "./routes/housekeeping.js";

const app = express();
const PORT = config.port;

app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.get("/", (_req, res) => {
  res.json({ message: "PMS API is running", version: "1.0.0" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/front-office", frontOfficeRoutes);
app.use("/api/food-beverages", foodBeveragesRoutes);
app.use("/api/housekeeping", housekeepingRoutes);

app.use(errorHandler);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("Request logging enabled — API hits will appear below.\n");
});
