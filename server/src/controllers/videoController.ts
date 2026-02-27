import { Request, Response } from "express";
import { generateVideo } from "../services/videoService";
import { checkApiLimit, increaseApiLimit } from "../repositories/userApiLimitRepository";
import { checkSubscription } from "../repositories/userSubscriptionRepository";

export const videoController = async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId;
    const { prompt } = req.body;

    if (!userId) {
      return res.status(401).send("Unauthorized");
    }

    if (!prompt) {
      return res.status(400).send("Prompt is required");
    }

    const freeTrial = await checkApiLimit(userId);
    const isPro = await checkSubscription(userId);

    if (!freeTrial && !isPro) {
      return res.status(403).send("Free Trial has Expired");
    }

    const response = await generateVideo(prompt);

    if (!isPro) {
      await increaseApiLimit(userId);
    }

    return res.json(response);
  } catch (error) {
    console.log("[VIDEO_ERROR]", error);
    return res.status(500).send("Internal Error");
  }
};
