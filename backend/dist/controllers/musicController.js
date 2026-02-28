"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.musicController = void 0;
const musicService_1 = require("../services/musicService");
const userApiLimitRepository_1 = require("../repositories/userApiLimitRepository");
const userSubscriptionRepository_1 = require("../repositories/userSubscriptionRepository");
const musicController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.body.userId;
        const { prompt } = req.body;
        if (!userId) {
            return res.status(401).send("Unauthorized");
        }
        if (!prompt) {
            return res.status(400).send("Prompt is required");
        }
        const freeTrial = yield (0, userApiLimitRepository_1.checkApiLimit)(userId);
        const isPro = yield (0, userSubscriptionRepository_1.checkSubscription)(userId);
        if (!freeTrial && !isPro) {
            return res.status(403).send("Free Trial has Expired");
        }
        const response = yield (0, musicService_1.generateMusic)(prompt);
        if (!isPro) {
            yield (0, userApiLimitRepository_1.increaseApiLimit)(userId);
        }
        return res.json(response);
    }
    catch (error) {
        console.log("[MUSIC_ERROR]", error);
        return res.status(500).send("Internal Error");
    }
});
exports.musicController = musicController;
