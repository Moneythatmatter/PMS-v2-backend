import { Router } from "express";
import * as auth from "../controllers/auth/auth.controller.js";

const router = Router();

router.post("/login", auth.login);
router.post("/platform-login", auth.loginPlatform);
router.get("/me", auth.me);

export default router;
