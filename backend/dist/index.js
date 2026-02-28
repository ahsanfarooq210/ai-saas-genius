"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./config/db");
const apiRoutes_1 = __importDefault(require("./routes/apiRoutes"));
const auth_1 = require("./auth");
const node_1 = require("better-auth/node");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
(0, db_1.connectDB)();
app.all("/api/auth/*", (0, node_1.toNodeHandler)(auth_1.auth));
app.use("/api", apiRoutes_1.default);
app.get("/", (req, res) => {
    res.send("AI SaaS Server is running");
});
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
