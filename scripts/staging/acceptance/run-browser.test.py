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

    def test_vercel_bypass_is_scoped_to_exact_origin_and_preserves_headers(self):
        expected = "https://staging.example.test"
        secret = "A" * 32
        headers = MODULE.origin_scoped_bypass_headers(
            "https://staging.example.test:443/student",
            expected,
            secret,
            {"accept": "text/html"},
        )
        self.assertEqual(headers["accept"], "text/html")
        self.assertEqual(headers["x-vercel-protection-bypass"], secret)
        self.assertEqual(headers["x-vercel-set-bypass-cookie"], "true")
        for target in (
            "https://staging.example.test:444/student",
            "https://user@staging.example.test/student",
            "https://staging.example.test.evil.test/student",
            "https://clerk.example.test/sign-in",
            "https://cdn.example.test/asset.js",
        ):
            scoped = MODULE.origin_scoped_bypass_headers(target, expected, secret, {"accept": "text/html"})
            self.assertEqual(scoped, {"accept": "text/html"})

    def test_vercel_bypass_removes_polluted_headers_before_origin_check(self):
        expected = "https://staging.example.test"
        secret = "A" * 32
        polluted = {
            "accept": "text/html",
            "X-Vercel-Protection-Bypass": "attacker-value",
            "x-vercel-set-bypass-cookie": "true",
        }
        scoped = MODULE.origin_scoped_bypass_headers(
            "https://clerk.example.test/continue",
            expected,
            secret,
            polluted,
        )
        self.assertEqual(scoped, {"accept": "text/html"})
        protected = MODULE.origin_scoped_bypass_headers(
            "https://staging.example.test/student",
            expected,
            secret,
            polluted,
        )
        self.assertEqual(protected["x-vercel-protection-bypass"], secret)
        self.assertEqual(protected["x-vercel-set-bypass-cookie"], "true")

    def test_vercel_bypass_rejects_malformed_secret_without_echoing_it(self):
        malformed = "not-a-valid-secret"
        with self.assertRaisesRegex(MODULE.AcceptanceFailure, "STAGING_VERCEL_AUTOMATION_BYPASS_SECRET_INVALID") as error:
            MODULE.origin_scoped_bypass_headers("https://staging.example.test", "https://staging.example.test", malformed)
        self.assertNotIn(malformed, str(error.exception))

    def test_base_url_rejects_empty_user_info_and_zero_port(self):
        for candidate in ("https://@cdas-next-preview.vercel.app", "https://cdas-next-preview.vercel.app:0", "https://other-preview.vercel.app"):
            with self.subTest(candidate=candidate), patch.dict(environ, {"STAGING_BASE_URL": candidate, "STAGING_VERCEL_PROJECT_NAME": "cdas-next"}):
                with self.assertRaisesRegex(MODULE.AcceptanceFailure, "STAGING_ACCEPTANCE_BASE_URL_INVALID"):
                    MODULE.base_url()

    def test_base_url_allows_only_configured_vercel_preview_root(self):
        with patch.dict(environ, {"STAGING_BASE_URL": "https://cdas-next-preview-linics1.vercel.app:443/", "STAGING_VERCEL_PROJECT_NAME": "cdas-next"}):
            self.assertEqual(MODULE.base_url(), "https://cdas-next-preview-linics1.vercel.app:443")

    def test_source_locks_ticket_origin_and_group_evidence(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertLess(source.index("assert_origin(page.url, remote)\n        ticket = issue_ticket"), source.index("ticket = issue_ticket") + 1)
        self.assertIn("window.top !== window", source)
        self.assertIn("AI_DISABLED_MANUAL_PATH", source)
        self.assertEqual(source.count('#classroom-roster-manager[data-hydrated="true"]'), 2)
        self.assertIn('("基本设置", "背景设定", "三维目标", "总体任务", "任务链", "评价标准")', source)
        self.assertIn('("任务设置", "背景设定", "学习目标", "总体任务", "任务链", "评价标准")', source)
        self.assertNotIn("#activity-learningObjectives", source)
        self.assertIn("TEACHER_STUDENT_RESOURCE_HIDDEN", source)
        self.assertIn("OTHER_STUDENT", source)
        self.assertIn('other_student_context = browser.new_context', source)
        self.assertIn('other_student.goto(f"{remote}{activity_href}"', source)
        self.assertIn('other_student.goto(f"{remote}{submission_href}"', source)
        self.assertIn("TEACHER_GROUP_CONFIGURED", source)
        self.assertIn("GROUPMATE_SHARED_PHASE_WRITE", source)
        self.assertIn("GROUPMATE_SHARED_SUBMISSION_VISIBLE", source)
        self.assertIn("GROUPMATE_SHARED_FEEDBACK_VISIBLE", source)
        self.assertIn('get_by_label("形成性下一步", exact=True).select_option("REVISE")', source)
        self.assertIn('get_by_label("支架层级", exact=True).select_option("FOUNDATION")', source)
        self.assertIn('"形成性下一步：按反馈修改并重交"', source)
        self.assertIn('"支架层级：基础支持"', source)
        self.assertIn("STRUCTURED_FORMATIVE_FEEDBACK_VISIBLE", source)
        self.assertIn("STUDENT_PRIVATE_ATTACHMENT_UPLOAD_AND_DOWNLOAD", source)
        self.assertIn("TEACHER_FORMAL_ATTACHMENT_DOWNLOAD", source)
        self.assertIn("GROUPMATE_SHARED_ATTACHMENT_DOWNLOAD", source)
        self.assertIn("GROUPMATE_TEACHER_SUBMISSION_404", source)
        self.assertIn('other_teacher_context = browser.new_context', source)
        self.assertIn('sign_in(other_teacher, remote, "other_teacher")', source)
        self.assertIn('other_teacher.goto(f"{remote}{release_href}"', source)
        self.assertIn('other_teacher.goto(f"{remote}{submission_href}"', source)
        self.assertIn("OTHER_TEACHER_RELEASE_404", source)
        self.assertIn("OTHER_TEACHER_SUBMISSION_404", source)
        self.assertIn("CLOSED_STUDENT_ATTACHMENT_READABLE", source)
        self.assertIn("expect_download", source)
        self.assertIn('locator("li").filter(has_text=filename).get_by_role("link")', source)
        self.assertIn("other_student_context.close()", source)
        self.assertIn("other_teacher_context.close()", source)
        self.assertIn('teacher.goto(f"{remote}{activity_href}"', source)
        self.assertNotIn("release_href.rsplit", source)
        self.assertNotIn("localStorage", source)
        self.assertNotIn("document.cookie", source)
        self.assertNotIn("extra_http_headers", source)
        self.assertNotIn("?x-vercel-protection-bypass", source)
        self.assertIn("install_origin_scoped_bypass", source)
        self.assertLess(
            source.index('sign_in(teacher, remote, "teacher")'),
            source.index('checks.append({"code": "VERCEL_PROTECTION_BYPASS_SCOPED"'),
        )

    def test_browser_checks_local_prerequisite_artifacts_before_clerk(self):
        with patch.object(MODULE.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
            MODULE.assert_browser_prerequisites()
            run.assert_called_once()
        with patch.object(MODULE.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "secret detail")):
            with self.assertRaisesRegex(MODULE.AcceptanceFailure, "STAGING_ACCEPTANCE_BROWSER_PREREQUISITES_NOT_GO"):
                MODULE.assert_browser_prerequisites()


if __name__ == "__main__":
    unittest.main()
