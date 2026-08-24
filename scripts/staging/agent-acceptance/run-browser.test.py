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
allowed_vercel_preview = module.allowed_vercel_preview
origin_scoped_bypass_headers = module.origin_scoped_bypass_headers
class HostTests(unittest.TestCase):
  def test_public_and_private_boundaries(self):
    for value in ("localhost","10.0.0.1","100.64.0.1","127.0.0.1","224.0.0.1","::","::ffff:127.0.0.1","x.lan"):
      self.assertFalse(public_hostname(value))
    self.assertTrue(public_hostname("staging.example.test"))
    self.assertTrue(allowed_vercel_preview("https://cdas-next-agent-linics1.vercel.app","cdas-next"))
    self.assertFalse(allowed_vercel_preview("https://other-agent.vercel.app","cdas-next"))
  def test_source_contract_uses_deterministic_real_ui_surface(self):
    source = pathlib.Path(__file__).with_name("run-browser.py").read_text(encoding="utf8")
    self.assertIn("#activity-assistant-prompt", source)
    self.assertEqual(source.count('#activity-assistant-prompt[data-hydrated="true"]'), 2)
    self.assertIn("交给助手整理", source)
    self.assertIn("继续核对活动并准备发布", source)
    self.assertIn("D-033 结构化任务理解与设计建议", source)
    self.assertIn("等待教师确认后再创建草稿", source)
    self.assertIn('aria-label="任务理解确认"', source)
    self.assertIn("确认理解并创建草稿", source)
    self.assertIn("教师已提供要求", source)
    self.assertIn("跨学科必要性", source)
    self.assertIn("目标—任务—证据—评价一致性链", source)
    self.assertIn("设置3个连续阶段", source)
    self.assertIn("问题意识、证据质量、跨学科连接、方案表达4个评价维度", source)
    self.assertIn('("基本设置", "背景设定", "三维目标", "总体任务", "任务链", "评价标准")', source)
    self.assertIn('("任务设置", "背景设定", "学习目标", "总体任务", "任务链", "评价标准")', source)
    self.assertIn("#activity-summary", source)
    self.assertIn("固定合成验收摘要（教师人工修订）", source)
    self.assertIn("保存并标记可预览", source)
    self.assertIn('get_by_text("草稿修订 2"', source)
    self.assertIn("signIn.create", source)
    self.assertIn('aria-label="发布确认"', source)
    self.assertIn('get_by_text("可使用", exact=True).wait_for(timeout=120_000)', source)
    self.assertIn('r"/teacher/releases/[0-9a-f-]+/submissions"', source)
    self.assertIn("level=1, exact=True", source)
    self.assertIn("full_page=True", source)
    self.assertIn("install_origin_scoped_bypass(context, base, bypass)", source)
    self.assertIn("VERCEL_PROTECTION_BYPASS_SCOPED", source)
    self.assertIn('sign_in(student, base, "STUDENT")', source)
    self.assertIn('sign_in(other_student, base, "OTHER_STUDENT")', source)
    self.assertIn('sign_in(other_teacher, base, "OTHER_TEACHER")', source)
    self.assertIn("#text-evidence", source)
    self.assertIn("确认正式提交", source)
    self.assertIn("#teacher-feedback-body", source)
    self.assertIn('get_by_label("形成性下一步", exact=True).select_option("REVISE")', source)
    self.assertIn('get_by_label("支架层级", exact=True).select_option("FOUNDATION")', source)
    self.assertIn("STRUCTURED_FORMATIVE_FEEDBACK_VISIBLE", source)
    self.assertIn("确认并保存最终反馈", source)
    self.assertIn("确认并关闭活动", source)
    self.assertIn("STALE_STUDENT_WRITE_REJECTED_AFTER_CLOSE", source)
    self.assertIn("CLOSED_STUDENT_READONLY", source)
    self.assertNotIn("sign-in?ticket=", source)
    self.assertNotIn("rm -rf", source)
    secret="A"*32
    self.assertIn("x-vercel-protection-bypass",origin_scoped_bypass_headers("https://cdas-next-agent-linics1.vercel.app/path","https://cdas-next-agent-linics1.vercel.app",secret))
    self.assertNotIn("x-vercel-protection-bypass",origin_scoped_bypass_headers("https://accounts.clerk.com/path","https://cdas-next-agent-linics1.vercel.app",secret))
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
    self.assertLess(source.index("assert_origin(page.url, base)"),source.index("issue_ticket(role)"))
    evaluate_source=source[source.index("signed_in = page.evaluate"):source.index("if not signed_in")]
    self.assertIn("window.top !== window",evaluate_source)
    self.assertLess(evaluate_source.index("window.location.origin !== expectedOrigin"),evaluate_source.index("window.Clerk"))
if __name__=="__main__": unittest.main()
