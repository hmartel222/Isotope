import importlib.metadata
from pathlib import Path
from typing import Any, Dict

from scripts.run_case import execute


ROOT = Path(__file__).resolve().parents[1]
PLANNING = ROOT / "fixtures" / "planning" / "render_job.json"
HELDOUT = ROOT / "fixtures" / "heldout" / "render_job.json"


def version() -> str:
    return importlib.metadata.version("elevenlabs")


def run(mode: str, fixture: Path = PLANNING) -> Dict[str, Any]:
    return execute(mode, fixture)
