import prismadb from "@/lib/prismadb";
import { auth } from "@clerk/nextjs";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const user = auth();
    if (!user.userId) {
      return NextResponse.json(
        {
          error: "Permission denied, user is not logged in",
        },
        { status: 401 }
      );
    }

    const data = await prismadb?.userDocuments.findMany({
      where: {
        userId: user.userId,
      },
    });

    return NextResponse.json({ data }, { status: 200 });

  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error }, { status: 500 });
  }
}
