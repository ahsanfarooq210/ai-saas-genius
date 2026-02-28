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
exports.getApiLimitCount = exports.checkApiLimit = exports.increaseApiLimit = exports.MAX_FREE_COUNTS = void 0;
const UserApiLimit_1 = require("../models/UserApiLimit");
exports.MAX_FREE_COUNTS = 5;
const increaseApiLimit = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!userId) {
        return;
    }
    const userApiLimit = yield UserApiLimit_1.UserApiLimit.findOne({ userId });
    if (userApiLimit) {
        userApiLimit.count += 1;
        yield userApiLimit.save();
    }
    else {
        yield UserApiLimit_1.UserApiLimit.create({ userId, count: 1 });
    }
});
exports.increaseApiLimit = increaseApiLimit;
const checkApiLimit = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!userId) {
        return false;
    }
    const userApiLimit = yield UserApiLimit_1.UserApiLimit.findOne({ userId });
    if (!userApiLimit || userApiLimit.count < exports.MAX_FREE_COUNTS) {
        return true;
    }
    else {
        return false;
    }
});
exports.checkApiLimit = checkApiLimit;
const getApiLimitCount = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!userId) {
        return 0;
    }
    const userApiLimit = yield UserApiLimit_1.UserApiLimit.findOne({ userId });
    if (!userApiLimit) {
        return 0;
    }
    return userApiLimit.count;
});
exports.getApiLimitCount = getApiLimitCount;
