import { Request, Response } from "express";
import { generateImage } from "../services/imageService";
import { checkApiLimit, increaseApiLimit } from "../repositories/userApiLimitRepository";
import { checkSubscription } from "../repositories/userSubscriptionRepository";

export const imageController = async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId;
    const { prompt, amount = 1, resolution = "512x512" } = req.body;

    if (!userId) {
      return res.status(401).send("Unauthorized");
    }

    if (!prompt) {
      return res.status(400).send("Prompt is required");
    }

    if (!amount) {
      return res.status(400).send("Amount is required");
    }

    if (!resolution) {
      return res.status(400).send("Resolution is required");
    }

    const freeTrial = await checkApiLimit(userId);
    const isPro = await checkSubscription(userId);

    if (!freeTrial && !isPro) {
      return res.status(403).send("Free Trial has Expired");
    }

    const response = await generateImage(prompt, parseInt(amount, 10), resolution);

    if (!isPro) {
      await increaseApiLimit(userId);
    }

    return res.json(response);
  } catch (error) {
    console.log("[IMAGE_ERROR]", error);
    return res.status(500).send("Internal Error");
  }
};
