import inspect
import unittest

from elevenlabs.client import ElevenLabs

from tests.support import run, version


@unittest.skipUnless(version() == "1.59.0", "requires the pinned old SDK")
class OldBaselineTests(unittest.TestCase):
    def test_historical_sdk_surface(self) -> None:
        client = ElevenLabs(api_key="test-key")
        self.assertTrue(hasattr(client, "generate"))
        signature = str(inspect.signature(client.generate))
        self.assertIn("voice:", signature)
        self.assertIn("model:", signature)

    def test_baseline_execution(self) -> None:
        result = run("original")
        signature = result["signature"]
        self.assertIsNone(signature["threw"])
        self.assertEqual(len(signature["calls"]), 1)
        self.assertEqual(signature["calls"][0]["mock"], "audio_repository.save")
        self.assertEqual(signature["returned"]["status"], "stored")

    def test_baseline_determinism(self) -> None:
        self.assertEqual(run("original")["signature"], run("original")["signature"])
