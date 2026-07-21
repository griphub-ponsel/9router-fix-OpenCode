import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("restart_9router.py")
spec = importlib.util.spec_from_file_location("restart_9router", MODULE_PATH)
restart = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restart)


class Restart9RouterTests(unittest.TestCase):
    def test_build_restart_command_uses_launchd_once(self):
        command = restart.build_restart_command(501, "ai.9router.gateway")
        self.assertEqual(command, [
            "launchctl", "kickstart", "-k", "gui/501/ai.9router.gateway"
        ])

    def test_parse_health_accepts_only_ok_json(self):
        self.assertTrue(restart.is_health_payload_ok(b'{"ok":true}'))
        self.assertFalse(restart.is_health_payload_ok(b'{"ok":false}'))
        self.assertFalse(restart.is_health_payload_ok(b'not-json'))

    def test_pid_parser_requires_numeric_pid(self):
        self.assertEqual(restart.parse_launchd_pid("pid = 12345\n"), 12345)
        self.assertIsNone(restart.parse_launchd_pid("state = waiting\n"))

    def test_restart_requires_a_different_live_pid(self):
        self.assertFalse(restart.restart_completed(old_pid=100, new_pid=100, healthy=True))
        self.assertFalse(restart.restart_completed(old_pid=100, new_pid=101, healthy=False))
        self.assertTrue(restart.restart_completed(old_pid=100, new_pid=101, healthy=True))
        self.assertTrue(restart.restart_completed(old_pid=None, new_pid=101, healthy=True))


if __name__ == "__main__":
    unittest.main()
