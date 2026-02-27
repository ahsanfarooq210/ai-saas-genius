import { UserApiLimit } from "../models/UserApiLimit";

export const MAX_FREE_COUNTS = 5;

export const increaseApiLimit = async (userId: string) => {
  if (!userId) {
    return;
  }

  const userApiLimit = await UserApiLimit.findOne({ userId });

  if (userApiLimit) {
    userApiLimit.count += 1;
    await userApiLimit.save();
  } else {
    await UserApiLimit.create({ userId, count: 1 });
  }
};

export const checkApiLimit = async (userId: string): Promise<boolean> => {
  if (!userId) {
    return false;
  }

  const userApiLimit = await UserApiLimit.findOne({ userId });

  if (!userApiLimit || userApiLimit.count < MAX_FREE_COUNTS) {
    return true;
  } else {
    return false;
  }
};

export const getApiLimitCount = async (userId: string) => {
  if (!userId) {
    return 0;
  }

  const userApiLimit = await UserApiLimit.findOne({ userId });

  if (!userApiLimit) {
    return 0;
  }

  return userApiLimit.count;
};
