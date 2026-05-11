import logging

from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()

logger = logging.getLogger(__name__)

# gemini-1.5-flash: 1,500 free requests/day (vs 20/day on gemini-3-flash preview).
# with_retry adds exponential backoff on 429 / 503 so transient quota bursts don't
# crash the entire swarm run – LangGraph will simply wait and retry the node.
_base_llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    temperature=0.2,
)

llm_gemini = _base_llm.with_retry(
    stop_after_attempt=5,
    wait_exponential_jitter=True,
)
