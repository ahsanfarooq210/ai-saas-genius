import { Request, Response } from "express";
import { generateConversation } from "../services/conversationService";
import { checkApiLimit, increaseApiLimit } from "../repositories/userApiLimitRepository";
import { checkSubscription } from "../repositories/userSubscriptionRepository";

export const conversationController = async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId;
    const { messages } = req.body;

    if (!userId) {
      return res.status(401).send("Unauthorized");
    }

    if (!messages) {
      return res.status(400).send("Messages are required");
    }

    const freeTrial = await checkApiLimit(userId);
    const isPro = await checkSubscription(userId);

    if (!freeTrial && !isPro) {
      return res.status(403).send("Free Trial has Expired");
    }

    const response = await generateConversation(messages);

    if (!isPro) {
      await increaseApiLimit(userId);
    }

    return res.json(response);
  } catch (error) {
    console.log("[CONVERSATION_ERROR]", error);
    return res.status(500).send("Internal Error");
  }
};
