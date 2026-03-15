import { betterAuth } from "better-auth";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.DATABASE_URL || "mongodb://localhost:27017/ai-saas");
const db = client.db();

export const auth = betterAuth({
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
