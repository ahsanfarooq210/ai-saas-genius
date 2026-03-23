from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()

llm_gemini = ChatGoogleGenerativeAI(model="gemini-3.1-flash-lite-preview")
