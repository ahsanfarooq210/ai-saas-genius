import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const instructionMessage: OpenAI.Chat.ChatCompletionMessageParam = {
  role: "system",
  content:
    "You are a code generator, you must answer only in markdown code snippets. Use code comments for explanations.",
};

export const generateCode = async (messages: any[]) => {
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [instructionMessage, ...messages],
  });
  return response.choices[0].message;
};
