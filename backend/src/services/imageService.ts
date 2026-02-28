import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const generateImage = async (
  prompt: string,
  amount: number,
  resolution: string
) => {
  const response = await openai.images.generate({
    prompt: prompt,
    n: amount,
    size: resolution as any,
  });
  return response.data;
};
