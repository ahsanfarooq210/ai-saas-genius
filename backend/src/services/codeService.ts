import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

// Note: Ensure the API key environment variable matches how you configure the client.
// We'll assume the environment uses GEMINI_API_KEY.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const instructionMessage = "You are a code generator, you must answer only in markdown code snippets. Use code comments for explanations.";

export const generateCode = async (messages: any[]) => {
  const contents = messages.map(msg => {
    return {
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }
  });

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro",
    contents: contents,
    config: {
      systemInstruction: instructionMessage
    }
  });

  return {
    role: "assistant",
    content: response.text
  };
};