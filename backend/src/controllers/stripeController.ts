import { Request, Response } from "express";
import { stripe } from "../services/stripeService";
import { UserSubscription } from "../models/UserSubscription";

const settingsUrl = process.env.SETTINGS_URL || "http://localhost:3000/settings";

export const stripeController = async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId;
    const user = req.body.user; // Mocked or retrieved from auth

    if (!userId || !user) {
      return res.status(401).send("Unauthorized");
    }

    const userSubscription = await UserSubscription.findOne({ userId });

    if (userSubscription && userSubscription.stripeCustomerId) {
      const stripeSession = await stripe.billingPortal.sessions.create({
        customer: userSubscription.stripeCustomerId,
        return_url: settingsUrl,
      });

      return res.json({ url: stripeSession.url });
    }

    const stripeSession = await stripe.checkout.sessions.create({
      success_url: settingsUrl,
      cancel_url: settingsUrl,
      payment_method_types: ["card"],
      mode: "subscription",
      billing_address_collection: "auto",
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: "USD",
            product_data: {
              name: "Genius Pro",
              description: "Unlimited AI Generations",
            },
            unit_amount: 2000,
            recurring: {
              interval: "month",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
      },
    });

    return res.json({ url: stripeSession.url });
  } catch (error) {
    console.log("[STRIPE ERROR]", error);
    return res.status(500).send("Internal Error");
  }
};
