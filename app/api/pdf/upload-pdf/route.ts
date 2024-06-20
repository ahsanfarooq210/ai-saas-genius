import { uploadFileToVectorStore } from "@/lib/langchain";
import { auth } from "@clerk/nextjs";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const pdfFile = formData.get("file");
    const { userId } = auth();
    const documentId = uuidv4();

    if (!userId) {
      return NextResponse.json(
        { message: "user id is missing" },
        { status: 400 }
      );
    }
    if (!documentId) {
      return NextResponse.json(
        { message: "document id is missing" },
        { status: 400 }
      );
    }
    if (!pdfFile) {
      return NextResponse.json(
        { message: "Pdf file which is to be uploaded is missing" },
        { status: 400 }
      );
    }

    const fileName = (pdfFile as File).name;

    await uploadFileToVectorStore(pdfFile as File, userId, documentId);

    await prisma?.userDocuments.create({
      data: {
        userId: userId,
        documentId,
        documentName: fileName,
      },
    });

    return NextResponse.json(
      {
        message: "success",
        data: {
          userId: userId,
          documentId: documentId,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error }, { status: 500 });
  }
}
