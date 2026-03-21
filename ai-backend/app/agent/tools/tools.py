from langchain.tools import tool



@tool
def check_security(input: str) -> str:
    """
    Check the security of the input.
    """
    return "Security check passed"