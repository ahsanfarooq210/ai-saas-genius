import { Configuration, OpenAIApi } from "openai";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs";
import { increaseApiLimit, checkApiLimit } from "@/lib/api-limit";
import { checkSubscription } from "@/lib/subscription";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

export async function POST(req: Request) {
  try {
    const userId = auth();
    const body = await req.json();
    const { messages } = body;

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!configuration.apiKey) {
      return new NextResponse("Open AI API key is not configured", {
        status: 500,
      });
    }

    if (!messages) {
      return new NextResponse("Messages are tequired", { status: 400 });
    }

    const freeTrial = await checkApiLimit();
    const isPro = await checkSubscription();

    if (!freeTrial && !isPro) {
      return new NextResponse("Free Trial has Expired", { status: 403 });
    }

    const resposne = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: messages,
    });

    if (!isPro) {
      await increaseApiLimit();
    }

    return NextResponse.json(resposne.data.choices[0].message);
  } catch (error) {
    console.log("[CONVERSATION_ERROR]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
