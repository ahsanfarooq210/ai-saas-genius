import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface AuthRequest extends Request {
  user?: any;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let accessToken;

  if (req.cookies && req.cookies.accessToken) {
    accessToken = req.cookies.accessToken;
  } else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    accessToken = req.headers.authorization.split(" ")[1];
  }

  if (!accessToken) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET || "fallback_secret") as any;

    req.user = decoded;
    req.body.userId = decoded.id; // Many controllers expect this

    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: "Not authorized, token failed" });
  }
};
