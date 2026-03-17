import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const generateImage = async (
  prompt: string,
  amount: number,
  resolution: string
) => {
  const response = await ai.models.generateImages({
    model: "nano banana",
    prompt: prompt,
    config: {
      numberOfImages: amount,
    }
  });

  if (!response.generatedImages) {
    return [];
  }

  return response.generatedImages.map((img: any) => ({
    b64_json: img.image?.imageBytes || ''
  }));
};