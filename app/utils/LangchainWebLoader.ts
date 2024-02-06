import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

export const Initializelangchain = async () => {
  const loader = new CheerioWebBaseLoader(
    "https://docs.smith.langchain.com/overview"
  );
  const docs = await loader.load();

  console.log(docs.length);
  console.log(docs[0].pageContent.length);

  const splitter = new RecursiveCharacterTextSplitter();
  const splitDocs = await splitter.splitDocuments(docs);
};
