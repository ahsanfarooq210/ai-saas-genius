import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db";
import apiRoutes from "./routes/apiRoutes";
import { auth } from "./auth";
import { toNodeHandler } from "better-auth/node";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());

connectDB();

app.all("/api/auth/*", toNodeHandler(auth));

app.use("/api", apiRoutes);

app.get("/", (req, res) => {
  res.send("AI SaaS Server is running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
