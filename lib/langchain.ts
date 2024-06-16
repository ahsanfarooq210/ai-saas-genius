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

// Function to add metadata to each chunk
const addMetadataToChunks = (chunks: any[], userId: string, documentId: string): any[] => {
  return chunks.map(chunk => ({
    ...chunk,
    metadata: {
      userId,
      documentId,
    }
  }));
};

// Main function to upload file to vector store
export const uploadFileToVectorStore = async (file: File, userId: string, documentId: string) => {
  // Create a Supabase client
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_API_KEY!
  );

  // Load the PDF document
  const loader = new WebPDFLoader(file);
  const docs = await loader.load();

  // Initialize the text splitter
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 750,
    chunkOverlap: 50,
    separators: ["\n\n", "\n", " ", ""], // default setting
  });

  // Create chunks of the documents
  const chunks = await textSplitter.splitDocuments(docs);

  // Add metadata to each chunk
  const chunksWithMetadata = addMetadataToChunks(chunks, userId, documentId);

  // Create batches of 100 chunks
  const chunkBatches = batchChunks(chunksWithMetadata, 100);

  // Upload each batch to the vector store
  const batchPromises: Promise<SupabaseVectorStore>[] = [];
  for (const batch of chunkBatches) {
    // Create promises of uploading 100 chunks
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

  // Upload all the chunks to the Supabase vector store
  await Promise.all(batchPromises);
};
