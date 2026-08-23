import importlib.util
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch


try:
    import playwright.sync_api  # noqa: F401
except ModuleNotFoundError:
    playwright = types.ModuleType("playwright")
    sync_api = types.ModuleType("playwright.sync_api")
    sync_api.Error = Exception
    sync_api.Page = object
    sync_api.sync_playwright = lambda: None
    playwright.sync_api = sync_api
    sys.modules["playwright"] = playwright
    sys.modules["playwright.sync_api"] = sync_api


MODULE_PATH = Path(__file__).with_name("run-browser.py")
SPEC = importlib.util.spec_from_file_location("staging_acceptance_browser", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BrowserContractTests(unittest.TestCase):
    def test_public_host_rules_reject_local_and_private_targets(self):
        for host in ("localhost", "127.0.0.1", "10.0.0.1", "100.64.0.1", "172.16.0.1", "192.168.1.1", "service.internal", "service.lan", "fe80::1", "::ffff:127.0.0.1", "ff00::1"):
            self.assertFalse(MODULE.is_public_hostname(host))
        self.assertTrue(MODULE.is_public_hostname("8.8.8.8"))
        self.assertTrue(MODULE.is_public_hostname("staging.example.test"))

    def test_error_output_is_stable_and_never_echoes_connection_details(self):
        self.assertEqual(MODULE.stable_code(RuntimeError("EXPECTED_CODE")), "EXPECTED_CODE")
        self.assertEqual(MODULE.stable_code(RuntimeError("postgresql://secret")), "STAGING_ACCEPTANCE_BROWSER_FAILED")

    def test_browser_checks_local_prerequisite_artifacts_before_clerk(self):
        with patch.object(MODULE.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
            MODULE.assert_browser_prerequisites()
            run.assert_called_once()
        with patch.object(MODULE.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "secret detail")):
            with self.assertRaisesRegex(MODULE.AcceptanceFailure, "STAGING_ACCEPTANCE_BROWSER_PREREQUISITES_NOT_GO"):
                MODULE.assert_browser_prerequisites()


if __name__ == "__main__":
    unittest.main()
