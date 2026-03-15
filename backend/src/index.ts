import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db";
import apiRoutes from "./routes/apiRoutes";
import authRoutes from "./routes/authRoutes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());

connectDB();

app.use("/api/auth", authRoutes);
app.use("/api", apiRoutes);

app.get("/", (req, res) => {
  res.send("AI SaaS Server is running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
