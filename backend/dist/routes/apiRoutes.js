"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const codeController_1 = require("../controllers/codeController");
const conversationController_1 = require("../controllers/conversationController");
const imageController_1 = require("../controllers/imageController");
const musicController_1 = require("../controllers/musicController");
const videoController_1 = require("../controllers/videoController");
const stripeController_1 = require("../controllers/stripeController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
router.post("/code", authMiddleware_1.authMiddleware, codeController_1.codeController);
router.post("/conversation", authMiddleware_1.authMiddleware, conversationController_1.conversationController);
router.post("/image", authMiddleware_1.authMiddleware, imageController_1.imageController);
router.post("/music", authMiddleware_1.authMiddleware, musicController_1.musicController);
router.post("/video", authMiddleware_1.authMiddleware, videoController_1.videoController);
router.get("/stripe", authMiddleware_1.authMiddleware, stripeController_1.stripeController); // Assuming stripe GET endpoint for portal/checkout
exports.default = router;
