"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserSubscription = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const UserSubscriptionSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, unique: true },
    stripeCustomerId: { type: String, unique: true, sparse: true },
    stripeSubscriptionId: { type: String, unique: true, sparse: true },
    stripePriceId: { type: String },
    stripeCurrentPeriodEnd: { type: Date },
});
exports.UserSubscription = mongoose_1.default.model("UserSubscription", UserSubscriptionSchema);
