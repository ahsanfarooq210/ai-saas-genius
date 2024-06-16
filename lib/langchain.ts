import { WebPDFLoader } from "langchain/document_loaders/web/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { createClient } from "@supabase/supabase-js";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { OpenAIEmbeddings } from "@langchain/openai";

// Function to batch the chunks
const batchChunks = (chunks: any[], batchSize: number): any[][] => {
  const batches = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    batches.push(batch);
  }
  return batches;
};

//in this function we are reciving a document and splitting the document and uploading it to the supabase vector store
export const uploadFileToVectorStore = async (file: File) => {
  //create a supabase client
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_API_KEY!
  );

  //for loading pdfs
  const loader = new WebPDFLoader(file);
  const docs = await loader.load();
  //initialize the text splitter
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 750,
    chunkOverlap: 50,
    separators: ["\n\n", "\n", " ", ""], // default setting
  });

  //create chunks of the documents
  const chunks = await textSplitter.splitDocuments(docs);
  //create batches of 100 chunks
  const chunkBatches = batchChunks(chunks, 100);

  // Upload each batch to the vector store
  const batchPromises: Promise<SupabaseVectorStore>[] = [];
  for (const batch of chunkBatches) {
    //create promises of uploading 100 chunks
    const promise = SupabaseVectorStore.fromDocuments(
      batch,
      new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY! }),
      {
        client,
        tableName: "documents",
      }
    );
    batchPromises.push(promise);
  }

  //upload all the chunks on the supabase vector store
  await Promise.all(batchPromises);

};


