import importlib.util
from pathlib import Path
import subprocess
import sys
import types
import unittest
from os import environ
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

    def test_origin_contract_rejects_deceptive_port_and_canonicalizes_https(self):
        expected = "https://staging.example.test"
        self.assertTrue(MODULE.exact_origin("https://staging.example.test:443/student", expected))
        self.assertFalse(MODULE.exact_origin("https://staging.example.test:444/student", expected))
        self.assertFalse(MODULE.exact_origin("https://staging.example.test:0/student", expected))
        self.assertFalse(MODULE.exact_origin("https://staging.example.test.evil.test/student", expected))
        self.assertEqual(MODULE.canonical_origin("https://staging.example.test:443/"), expected)
        self.assertEqual(MODULE.canonical_origin("https://[2606:4700::6810:85e5]:443/"), "https://[2606:4700::6810:85e5]")

    def test_base_url_rejects_empty_user_info_and_zero_port(self):
        for candidate in ("https://@staging.example.test", "https://staging.example.test:0"):
            with self.subTest(candidate=candidate), patch.dict(environ, {"STAGING_BASE_URL": candidate}):
                with self.assertRaisesRegex(MODULE.AcceptanceFailure, "STAGING_ACCEPTANCE_BASE_URL_INVALID"):
                    MODULE.base_url()

    def test_source_locks_ticket_origin_logout_and_new_evidence(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertLess(source.index("assert_origin(page.url, remote)\n        ticket = issue_ticket"), source.index("ticket = issue_ticket") + 1)
        self.assertIn("window.top !== window", source)
        self.assertIn("退出登录", source)
        self.assertIn("AI_DISABLED_MANUAL_PATH", source)
        self.assertIn("TEACHER_STUDENT_RESOURCE_HIDDEN", source)
        self.assertIn("OTHER_STUDENT", source)
        self.assertIn('other_student_context = browser.new_context', source)
        self.assertIn('other_student.goto(f"{remote}{activity_href}"', source)
        self.assertIn('other_student.goto(f"{remote}{submission_href}"', source)
        self.assertIn("OTHER_STUDENT_SUBMISSION_CONTENT_HIDDEN", source)
        self.assertIn("other_student_context.close()", source)
        self.assertIn('teacher.goto(f"{remote}{activity_href}"', source)
        self.assertNotIn("release_href.rsplit", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("document.cookie", source)

    def test_browser_checks_local_prerequisite_artifacts_before_clerk(self):
        with patch.object(MODULE.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
            MODULE.assert_browser_prerequisites()
            run.assert_called_once()
        with patch.object(MODULE.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "secret detail")):
            with self.assertRaisesRegex(MODULE.AcceptanceFailure, "STAGING_ACCEPTANCE_BROWSER_PREREQUISITES_NOT_GO"):
                MODULE.assert_browser_prerequisites()


if __name__ == "__main__":
    unittest.main()
