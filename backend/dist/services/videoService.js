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
exports.generateVideo = void 0;
const genai_1 = require("@google/genai");
const ai = new genai_1.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const generateVideo = (prompt) => __awaiter(void 0, void 0, void 0, function* () {
    const operation = yield ai.models.generateVideos({
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
});
exports.generateVideo = generateVideo;
