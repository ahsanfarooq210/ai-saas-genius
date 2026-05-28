from langchain_core.tools import tool
import re


# TODO: Swap to use a a more through and strict Mermaid parser library
@tool
def mermaid_linter(diagram: str) -> str:
    """
    Validates Mermaid diagram syntax.
    Returns 'OK' if valid, or a specific error string if invalid.
    The error string is used directly in the fix prompt — be specific.
    """
    diagram = diagram.strip()

    if not diagram:
        return "Error: diagram is empty"

    # Must start with a valid diagram type declaration
    valid_starts = (
        "flowchart",
        "graph",
        "sequenceDiagram",
        "classDiagram",
        "erDiagram",
        "gantt",
        "stateDiagram",
        "pie",
        "gitGraph",
    )

    first_line = diagram.split("\n")[0].strip().lower()
    if not any(first_line.startswith(v.lower()) for v in valid_starts):
        return (
            f"Error: diagram must start with a valid type declaration "
            f"(flowchart TD, sequenceDiagram, etc). "
            f"Got: '{diagram.split(chr(10))[0]}'"
        )

    # Check for unclosed brackets
    open_brackets = diagram.count("(") + diagram.count("[") + diagram.count("{")
    closed_brackets = diagram.count(")") + diagram.count("]") + diagram.count("}")
    if open_brackets != closed_brackets:
        return (
            f"Error: mismatched brackets. "
            f"Opening: {open_brackets}, Closing: {closed_brackets}. "
            f"Check all [], (), and {{}} pairs."
        )

    # Check for empty node labels

    if re.search(r"\[\s*\]|\(\s*\)|\{\s*\}", diagram):
        return "Error: found empty node label [] or () or {}. Every node must have a label."

    return "OK"
