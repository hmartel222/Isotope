import json
import unittest

from tests.support import HELDOUT, PLANNING, run, version


class HeldoutTests(unittest.TestCase):
    def test_planning_and_heldout_inputs_are_independent(self) -> None:
        planning = json.loads(PLANNING.read_text(encoding="utf-8"))
        heldout = json.loads(HELDOUT.read_text(encoding="utf-8"))
        for field in ("job_id", "document_id", "text", "voice_id"):
            self.assertNotEqual(planning[field], heldout[field])

    def test_heldout_baseline_or_migration_succeeds(self) -> None:
        mode = "original" if version() == "1.59.0" else "oracle"
        signature = run(mode, HELDOUT)["signature"]
        self.assertIsNone(signature["threw"])
        self.assertEqual(signature["returned"]["job_id"], "job_holdout_B")
        self.assertEqual(len(signature["calls"]), 1)

    def test_planning_and_heldout_audio_hashes_differ(self) -> None:
        mode = "original" if version() == "1.59.0" else "oracle"
        planning = run(mode, PLANNING)["signature"]["calls"][0]["args"]
        heldout = run(mode, HELDOUT)["signature"]["calls"][0]["args"]
        self.assertNotEqual(planning["content_sha256"], heldout["content_sha256"])
