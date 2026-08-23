import importlib.util
import pathlib
import unittest
spec = importlib.util.spec_from_file_location("agent_browser", pathlib.Path(__file__).with_name("run-browser.py"))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
public_hostname = module.public_hostname
exact_origin = module.exact_origin
canonical_origin = module.canonical_origin
class HostTests(unittest.TestCase):
  def test_public_and_private_boundaries(self):
    for value in ("localhost","10.0.0.1","100.64.0.1","127.0.0.1","224.0.0.1","::","::ffff:127.0.0.1","x.lan"):
      self.assertFalse(public_hostname(value))
    self.assertTrue(public_hostname("staging.example.test"))
  def test_source_contract_uses_deterministic_real_ui_surface(self):
    source = pathlib.Path(__file__).with_name("run-browser.py").read_text(encoding="utf8")
    self.assertIn("#activity-assistant-prompt", source)
    self.assertIn("交给助手整理", source)
    self.assertIn("继续核对活动并准备发布", source)
    self.assertIn("立即调用 create_activity_draft 工具", source)
    self.assertIn("signIn.create", source)
    self.assertIn('aria-label="发布确认"', source)
    self.assertIn("level=1,exact=True", source)
    self.assertIn("full_page=True", source)
    self.assertNotIn("sign-in?ticket=", source)
    self.assertNotIn("rm -rf", source)
  def test_ticket_origin_rejects_cross_origin_redirects(self):
    expected="https://staging.example.test"
    self.assertTrue(exact_origin("https://staging.example.test/teacher/activities/new",expected))
    self.assertTrue(exact_origin("https://staging.example.test:443/",expected))
    self.assertFalse(exact_origin("http://staging.example.test/",expected))
    self.assertFalse(exact_origin("https://evil.example.test/",expected))
    self.assertFalse(exact_origin("https://staging.example.test.evil.test/",expected))
    self.assertFalse(exact_origin("https://staging.example.test:444/",expected))
    self.assertEqual(canonical_origin("https://staging.example.test:443/"),expected)
    source = pathlib.Path(__file__).with_name("run-browser.py").read_text(encoding="utf8")
    self.assertLess(source.index("assert_origin(page.url,base)"),source.index("staging:agent:issue-teacher-ticket"))
    evaluate_source=source[source.index("signed_in=page.evaluate"):source.index("if not signed_in")]
    self.assertIn("window.top !== window",evaluate_source)
    self.assertLess(evaluate_source.index("window.location.origin !== expectedOrigin"),evaluate_source.index("window.Clerk"))
if __name__=="__main__": unittest.main()
