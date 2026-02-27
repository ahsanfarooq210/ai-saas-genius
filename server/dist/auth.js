"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
const better_auth_1 = require("better-auth");
const mongodb_1 = require("mongodb");
const client = new mongodb_1.MongoClient(process.env.DATABASE_URL || "");
const db = client.db();
exports.auth = (0, better_auth_1.betterAuth)({
    database: {
        db: db,
        type: "mongodb",
    },
    emailAndPassword: {
        enabled: true
    },
    socialProviders: {
        github: {
            clientId: process.env.GITHUB_CLIENT_ID || "",
            clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
        },
    },
});
