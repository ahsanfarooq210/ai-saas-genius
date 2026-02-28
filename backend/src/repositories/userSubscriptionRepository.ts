import { UserSubscription } from "../models/UserSubscription";

const DAY_IN_MS = 86_400_000;

export const checkSubscription = async (userId: string) => {
  if (!userId) {
    return false;
  }

  const userSubscription = await UserSubscription.findOne({ userId });

  if (!userSubscription) {
    return false;
  }

  const isValid =
    userSubscription.stripePriceId &&
    userSubscription.stripeCurrentPeriodEnd?.getTime()! + DAY_IN_MS >
      Date.now();

  return !!isValid;
};
