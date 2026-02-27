import express from "express";
import { codeController } from "../controllers/codeController";
import { conversationController } from "../controllers/conversationController";
import { imageController } from "../controllers/imageController";
import { musicController } from "../controllers/musicController";
import { videoController } from "../controllers/videoController";
import { stripeController } from "../controllers/stripeController";
import { authMiddleware } from "../middleware/authMiddleware";

const router = express.Router();

router.post("/code", authMiddleware, codeController);
router.post("/conversation", authMiddleware, conversationController);
router.post("/image", authMiddleware, imageController);
router.post("/music", authMiddleware, musicController);
router.post("/video", authMiddleware, videoController);
router.get("/stripe", authMiddleware, stripeController); // Assuming stripe GET endpoint for portal/checkout

export default router;
