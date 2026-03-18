import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const generateConversation = async (messages: any[]) => {
  // Since we don't know the exact structure of messages array and how to map it properly to gemini-3.1-pro
  // chat format out of the box with the new @google/genai SDK, we'll extract the text.
  // Actually, usually it's `contents: [...]`.
  // Let's look at the structure that typically comes from the frontend (which mimics OpenAI).
  // The frontend typically sends `[{role: 'user', content: 'hello'}]`

  const contents = messages.map(msg => {
    return {
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }
  });

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro",
    contents: contents,
  });

  // Format response back to what frontend expects from OpenAI shape or general `{role: string, content: string}`
  return {
    role: "assistant", // or "model" but frontend likely expects "assistant" as it used OpenAI
    content: response.text
  };
};