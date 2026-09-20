import inspect
import unittest

from elevenlabs.client import ElevenLabs

from tests.support import run, version


@unittest.skipUnless(version() == "2.0.0", "requires the pinned new SDK")
class NewDependencyBreakTests(unittest.TestCase):
    def test_upgraded_sdk_surface(self) -> None:
        client = ElevenLabs(api_key="test-key")
        self.assertFalse(hasattr(client, "generate"))
        self.assertTrue(hasattr(client.text_to_speech, "convert"))
        signature = str(inspect.signature(client.text_to_speech.convert))
        self.assertIn("voice_id:", signature)
        self.assertIn("model_id:", signature)

    def test_dependency_only_upgrade_breaks_for_real_missing_method(self) -> None:
        signature = run("original")["signature"]
        self.assertEqual(signature["threw"]["type"], "AttributeError")
        self.assertIn("no attribute 'generate'", signature["threw"]["message"])

    def test_sink_disappears(self) -> None:
        self.assertEqual(run("original")["signature"]["calls"], [])
