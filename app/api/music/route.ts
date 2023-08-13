import { Configuration, OpenAIApi } from "openai";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

export async function POST(req: Request) {
  try {
    const userId = auth();
    const body = await req.json();
    const { message } = body;
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!configuration.apiKey) {
      return new NextResponse("Open AI API key is not configured", {
        status: 500,
      });
    }

    if (!message) {
      return new NextResponse("Messages are tequired", { status: 400 });
    }
    const resposne = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: message,
    });
    return NextResponse.json(resposne.data.choices[0].message);
  } catch (error) {
    console.log("[CONVERSATION_ERROR]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}