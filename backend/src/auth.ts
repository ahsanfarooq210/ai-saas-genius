import { betterAuth } from "better-auth";
import { MongoClient } from "mongodb";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import dotenv from "dotenv";

dotenv.config();

const client = new MongoClient(process.env.DATABASE_URL || "mongodb://localhost:27017/ai-saas");
const db = client.db();

export const auth = betterAuth({
    trustedOrigins: [process.env.WEB_APP_URL || "http://localhost:5173"],
    database: mongodbAdapter(db, {
        client
    }),
    emailAndPassword: {
        enabled: true
    },
    experimental: {
        joins: true
    }
});
