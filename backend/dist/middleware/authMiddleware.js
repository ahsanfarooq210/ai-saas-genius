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
exports.authMiddleware = void 0;
const auth_1 = require("../auth");
const node_1 = require("better-auth/node");
const authMiddleware = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const session = yield auth_1.auth.api.getSession({
        headers: (0, node_1.fromNodeHeaders)(req.headers)
    });
    if (!session) {
        return res.status(401).send("Unauthorized");
    }
    req.body.userId = session.user.id;
    req.body.user = session.user;
    next();
});
exports.authMiddleware = authMiddleware;
