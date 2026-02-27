"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripeController = void 0;
const stripeService_1 = require("../services/stripeService");
const UserSubscription_1 = require("../models/UserSubscription");
const settingsUrl = process.env.SETTINGS_URL || "http://localhost:3000/settings";
const stripeController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.body.userId;
        const user = req.body.user; // Mocked or retrieved from auth
        if (!userId || !user) {
            return res.status(401).send("Unauthorized");
        }
        const userSubscription = yield UserSubscription_1.UserSubscription.findOne({ userId });
        if (userSubscription && userSubscription.stripeCustomerId) {
            const stripeSession = yield stripeService_1.stripe.billingPortal.sessions.create({
                customer: userSubscription.stripeCustomerId,
                return_url: settingsUrl,
            });
            return res.json({ url: stripeSession.url });
        }
        const stripeSession = yield stripeService_1.stripe.checkout.sessions.create({
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
    }
    catch (error) {
        console.log("[STRIPE ERROR]", error);
        return res.status(500).send("Internal Error");
    }
});
exports.stripeController = stripeController;
