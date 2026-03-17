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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCode = void 0;
const genai_1 = require("@google/genai");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Note: Ensure the API key environment variable matches how you configure the client.
// We'll assume the environment uses GEMINI_API_KEY.
const ai = new genai_1.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const instructionMessage = "You are a code generator, you must answer only in markdown code snippets. Use code comments for explanations.";
const generateCode = (messages) => __awaiter(void 0, void 0, void 0, function* () {
    const contents = messages.map(msg => {
        return {
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        };
    });
    const response = yield ai.models.generateContent({
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
});
exports.generateCode = generateCode;
