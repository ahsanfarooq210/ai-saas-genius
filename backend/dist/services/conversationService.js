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
exports.generateConversation = void 0;
const genai_1 = require("@google/genai");
const ai = new genai_1.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const generateConversation = (messages) => __awaiter(void 0, void 0, void 0, function* () {
    // Since we don't know the exact structure of messages array and how to map it properly to gemini-3.1-pro
    // chat format out of the box with the new @google/genai SDK, we'll extract the text.
    // Actually, usually it's `contents: [...]`.
    // Let's look at the structure that typically comes from the frontend (which mimics OpenAI).
    // The frontend typically sends `[{role: 'user', content: 'hello'}]`
    const contents = messages.map(msg => {
        return {
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        };
    });
    const response = yield ai.models.generateContent({
        model: "gemini-3.1-pro",
        contents: contents,
    });
    // Format response back to what frontend expects from OpenAI shape or general `{role: string, content: string}`
    return {
        role: "assistant", // or "model" but frontend likely expects "assistant" as it used OpenAI
        content: response.text
    };
});
exports.generateConversation = generateConversation;
