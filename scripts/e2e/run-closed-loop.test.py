import pathlib
import unittest


class RealModelSmokeContractTests(unittest.TestCase):
    def test_d033_proposal_is_confirmed_before_preview(self):
        source = pathlib.Path(__file__).with_name("run-closed-loop.py").read_text(
            encoding="utf-8"
        )
        flow = source[source.index("def run_real_model_browser_flow") :]
        self.assertIn("D-033 結構化任務理解與設計建議", flow)
        self.assertIn('aria-label="任务理解确认"', flow)
        self.assertIn("确认理解并创建草稿", flow)
        self.assertIn("01-real-model-draft-proposal", flow)
        self.assertIn("02-real-model-draft-preview", flow)
        self.assertLess(
            flow.index("01-real-model-draft-proposal"),
            flow.index("page.wait_for_url("),
        )


if __name__ == "__main__":
    unittest.main()
