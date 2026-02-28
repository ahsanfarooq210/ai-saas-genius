"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserApiLimit = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const UserApiLimitSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
}, { timestamps: true });
exports.UserApiLimit = mongoose_1.default.model("UserApiLimit", UserApiLimitSchema);
