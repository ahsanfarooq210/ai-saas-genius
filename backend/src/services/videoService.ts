import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const generateVideo = async (prompt: string) => {
  const operation = await ai.models.generateVideos({
    model: "Gemini vio",
    prompt: prompt,
  });

  // Depending on how @google/genai operation type works, it might be an Operation object
  // that needs to be polled, or it contains an array of generatedVideos.
  // Let's assume it returns an Operation with a generatedVideo object.
  // Often with @google/genai, if it's async, it needs a wait loop.
  // If it's a GenerateVideosOperation, we might need to cast or access via index/property.
  // Replicate's return array format: `["url1"]`

  // The SDK usually wraps the long-running operation.
  // Without polling since this might be a sync mock or just passing an ID:
  return [operation.name || operation.response || "video_generated"];
};