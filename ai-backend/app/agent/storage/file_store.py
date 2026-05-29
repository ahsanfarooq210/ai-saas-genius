"""Local artifact persistence — swap backing store in Phase 11 without changing callers."""

from __future__ import annotations

import os


class FileStore:
    def __init__(self, base_dir: str = "output") -> None:
        self.base_dir = base_dir

    def save_doc(self, path: str, content: str) -> str:
        """
        Save Markdown under base_dir.
        path format: reports/{thread_id}/{filename}.md
        """
        return self._write(path, content)

    def save_diagram(self, path: str, content: str) -> str:
        """
        Save Mermaid under base_dir.
        path format: diagrams/{thread_id}/iter{n}_{type}.mmd
        """
        return self._write(path, content)

    def _write(self, path: str, content: str) -> str:
        full_path = os.path.join(self.base_dir, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"[file_store] saved: {full_path}")
        return full_path


file_store = FileStore()
