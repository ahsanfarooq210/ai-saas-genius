import mongoose from "mongoose";

export interface IUserSubscription extends mongoose.Document {
  userId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  stripeCurrentPeriodEnd?: Date;
}

const UserSubscriptionSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  stripeCustomerId: { type: String, unique: true, sparse: true },
  stripeSubscriptionId: { type: String, unique: true, sparse: true },
  stripePriceId: { type: String },
  stripeCurrentPeriodEnd: { type: Date },
});

export const UserSubscription = mongoose.model<IUserSubscription>(
  "UserSubscription",
  UserSubscriptionSchema
);
