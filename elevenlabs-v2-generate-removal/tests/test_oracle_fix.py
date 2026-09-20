import unittest

from tests.support import run, version


@unittest.skipUnless(version() == "2.0.0", "requires the pinned new SDK")
class OracleFixTests(unittest.TestCase):
    def test_oracle_restores_successful_sink(self) -> None:
        signature = run("oracle")["signature"]
        self.assertIsNone(signature["threw"])
        self.assertEqual(signature["returned"]["status"], "stored")
        self.assertEqual(len(signature["calls"]), 1)
        self.assertEqual(signature["calls"][0]["mock"], "audio_repository.save")

    def test_oracle_is_deterministic(self) -> None:
        self.assertEqual(run("oracle")["signature"], run("oracle")["signature"])
