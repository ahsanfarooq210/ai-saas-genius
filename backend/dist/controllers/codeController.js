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
exports.codeController = void 0;
const codeService_1 = require("../services/codeService");
const userApiLimitRepository_1 = require("../repositories/userApiLimitRepository");
const userSubscriptionRepository_1 = require("../repositories/userSubscriptionRepository");
const codeController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.body.userId; // In real app, get from auth middleware
        const { messages } = req.body;
        if (!userId) {
            return res.status(401).send("Unauthorized");
        }
        if (!messages) {
            return res.status(400).send("Messages are required");
        }
        const freeTrial = yield (0, userApiLimitRepository_1.checkApiLimit)(userId);
        const isPro = yield (0, userSubscriptionRepository_1.checkSubscription)(userId);
        if (!freeTrial && !isPro) {
            return res.status(403).send("Free Trial has Expired");
        }
        const response = yield (0, codeService_1.generateCode)(messages);
        if (!isPro) {
            yield (0, userApiLimitRepository_1.increaseApiLimit)(userId);
        }
        return res.json(response);
    }
    catch (error) {
        console.log("[CODE_ERROR]", error);
        return res.status(500).send("Internal Error");
    }
});
exports.codeController = codeController;
