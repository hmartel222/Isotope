import unittest

from tests.support import HELDOUT, run, version


class SafetyAndDeterminismTests(unittest.TestCase):
    def test_no_execution_attempts_network_access(self) -> None:
        modes = ["original"] if version() == "1.59.0" else ["original", "oracle"]
        for mode in modes:
            self.assertEqual(run(mode)["networkAttempts"], [])

    def test_heldout_execution_is_deterministic(self) -> None:
        mode = "original" if version() == "1.59.0" else "oracle"
        self.assertEqual(run(mode, HELDOUT)["signature"], run(mode, HELDOUT)["signature"])
