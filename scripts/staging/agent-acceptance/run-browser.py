"""Protected full-loop Agent acceptance browser runner.

The real model is used only for the initial design proposal and publish preparation. All
student, feedback, close, and isolation steps use the same first-party UI and
the same Release produced by the Agent flow.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone
from typing import Mapping
from urllib.parse import urlsplit


SCREENSHOTS = (
    "01-draft-proposal.png",
    "02-draft-preview.png",
    "03-publish-approval.png",
    "04-published.png",
    "05-student-submitted.png",
    "06-teacher-feedback.png",
    "07-teacher-closed.png",
    "08-student-closed-readonly.png",
)
CREATE_PROMPT = """资料已经完整，不要提问。标题必须逐字为：{title}。请调用 create_activity_draft 提出一份 D-033 结构化任务理解与设计建议，等待教师确认后再创建草稿。围绕“学生辨识合成证据”生成完整跨学科任务书：初中七年级，主学科语文，融合数学与信息科技，探究性作业／调查探究／中等探究／一次性提交／2周，以核验校园档案中的合成内容为真实情境。提案必须明确教师已提供要求、没有事实根据的假设、数学与信息科技各自不可替代的贡献，以及知识与技能／过程与方法／情感态度三条完整的目标—任务—证据—评价链。完整内容必须包含探究主题、任务描述、背景设定、三维目标、总体任务；设置3个连续阶段，每阶段都要有明确行动、情境承接、学习支架、至少一项类型化提交证据、评价要点和课时建议；设置问题意识、证据质量、跨学科连接、方案表达4个评价维度，每个维度都有优秀、良好、合格、需改进四档非空描述。"""
EDITED_SUMMARY = "固定合成验收摘要（教师人工修订）"
PUBLISH_PROMPT = "立即调用 publish_activity_release 工具，将版本2发布到班级：{classroom}。无截止日期。"
EVIDENCE_TEXT = "Synthetic Agent acceptance text evidence."
FEEDBACK_TEXT = "Synthetic Agent acceptance teacher feedback."


class AcceptanceFailure(RuntimeError):
    """Only stable, non-sensitive failure codes may leave this process."""


def public_hostname(host: str) -> bool:
    host = host.strip().strip("[]").lower().rstrip(".")
    if not host or host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan")):
        return False
    try:
        address = ipaddress.ip_address(host)
        carrier_grade_nat = (
            address.version == 4
            and int(address) >= int(ipaddress.ip_address("100.64.0.0"))
            and int(address) <= int(ipaddress.ip_address("100.127.255.255"))
        )
        return not (
            carrier_grade_nat
            or address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_unspecified
            or address.is_reserved
        )
    except ValueError:
        return bool(
            re.fullmatch(
                r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+",
                host,
            )
        )


def exact_origin(candidate: str, expected: str) -> bool:
    try:
        candidate_url = urlsplit(candidate)
        expected_url = urlsplit(expected)
        candidate_port = candidate_url.port or (443 if candidate_url.scheme.lower() == "https" else 80)
        expected_port = expected_url.port or (443 if expected_url.scheme.lower() == "https" else 80)
        return (
            candidate_url.scheme.lower() == expected_url.scheme.lower()
            and candidate_url.hostname == expected_url.hostname
            and candidate_port == expected_port
            and candidate_url.username is None
            and candidate_url.password is None
        )
    except ValueError:
        return False


def canonical_origin(value: str) -> str:
    parsed = urlsplit(value)
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    hostname = parsed.hostname or ""
    rendered_host = f"[{hostname}]" if ":" in hostname else hostname
    default_port = (parsed.scheme.lower() == "https" and port == 443) or (
        parsed.scheme.lower() == "http" and port == 80
    )
    return f"{parsed.scheme.lower()}://{rendered_host}{'' if default_port else f':{port}'}"


def assert_origin(candidate: str, expected: str) -> None:
    if not exact_origin(candidate, expected):
        raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_ORIGIN_MISMATCH")


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise AcceptanceFailure(f"{name}_REQUIRED")
    return value


def valid_vercel_project_name(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?", value.lower()))


def allowed_vercel_preview(raw: str, project_name: str) -> bool:
    project = project_name.strip().lower()
    if not valid_vercel_project_name(project):
        return False
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError:
        return False
    hostname = (parsed.hostname or "").lower()
    suffix = ".vercel.app"
    prefix = f"{project}-"
    deployment = hostname[len(prefix) : -len(suffix)] if hostname.startswith(prefix) and hostname.endswith(suffix) else ""
    return (
        parsed.scheme == "https"
        and port in (None, 443)
        and parsed.path in ("", "/")
        and not parsed.query
        and not parsed.fragment
        and parsed.username is None
        and parsed.password is None
        and bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,251}[a-z0-9])?", deployment))
        and "." not in deployment
    )


def valid_bypass_secret(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9]{32}", value))


def origin_scoped_bypass_headers(
    candidate: str,
    expected: str,
    secret: str,
    headers: Mapping[str, str] | None = None,
) -> dict[str, str]:
    if not valid_bypass_secret(secret):
        raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_BYPASS_INVALID")
    result = {
        name: value
        for name, value in (headers or {}).items()
        if name.lower() not in ("x-vercel-protection-bypass", "x-vercel-set-bypass-cookie")
    }
    if exact_origin(candidate, expected):
        result["x-vercel-protection-bypass"] = secret
        result["x-vercel-set-bypass-cookie"] = "true"
    return result


def install_origin_scoped_bypass(context, expected: str, secret: str) -> None:
    def continue_request(route) -> None:
        route.continue_(
            headers=origin_scoped_bypass_headers(
                route.request.url,
                expected,
                secret,
                route.request.headers,
            )
        )

    context.route("**/*", continue_request)


def fail() -> None:
    print('{"schema":"staging-agent-acceptance-browser.v1","status":"FAIL"}')
    raise SystemExit(1)


def marker() -> str:
    value = os.environ.get("STAGING_RUN_MARKER", "").strip()
    if not re.fullmatch(r"cdas-staging-agent-[a-z0-9-]{8,80}", value):
        fail()
    return value


def output(marker_value: str) -> Path:
    return Path("output/staging-agent-acceptance") / marker_value


def run(command: list[str], capture: bool = False) -> str:
    result = subprocess.run(command, check=False, capture_output=capture, text=True)
    if result.returncode:
        raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_COMMAND_FAILED")
    return result.stdout


def issue_ticket(role: str) -> str:
    ticket = run(["pnpm", "staging:agent:issue-teacher-ticket", role], True).strip()
    if not ticket or len(ticket) > 16_384 or "\n" in ticket:
        raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_TICKET_INVALID")
    return ticket


def sign_in(page, base: str, role: str) -> None:
    destination = "teacher" if role in ("TEACHER", "OTHER_TEACHER") else "student"
    ticket = ""
    try:
        response = page.goto(base, wait_until="domcontentloaded")
        assert_origin(page.url, base)
        if not response or response.status != 200:
            raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_INITIAL_REQUEST_FAILED")
        page.wait_for_function(
            "() => Boolean(window.Clerk?.loaded && window.Clerk.status === 'ready' && window.Clerk.client)",
            timeout=60_000,
        )
        assert_origin(page.url, base)
        ticket = issue_ticket(role)
        signed_in = page.evaluate(
            """async ({ticket, expectedOrigin}) => {
              if (window.top !== window || window.location.origin !== expectedOrigin) return false;
              const clerk = window.Clerk;
              if (!clerk?.loaded || clerk.status !== 'ready' || !clerk.client) return false;
              await clerk.signOut();
              const result = await clerk.client.signIn.create({ strategy: 'ticket', ticket });
              if (result.status !== 'complete' || !result.createdSessionId) return false;
              await clerk.setActive({ session: result.createdSessionId });
              return true;
            }""",
            {"ticket": ticket, "expectedOrigin": canonical_origin(base)},
        )
        if not signed_in:
            raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_SIGN_IN_FAILED")
        page.goto(f"{base}/{destination}", wait_until="domcontentloaded")
        assert_origin(page.url, base)
        if urlsplit(page.url).path != f"/{destination}":
            raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_SIGN_IN_REDIRECT")
    finally:
        ticket = ""


def wait_text(page, value: str) -> None:
    page.get_by_text(value, exact=False).last.wait_for(state="visible", timeout=30_000)


def confirm(page, title: str, button: str) -> None:
    dialog = page.get_by_role("dialog").filter(has_text=title)
    dialog.wait_for(state="visible", timeout=30_000)
    dialog.get_by_role("button", name=button, exact=True).click()
    dialog.wait_for(state="hidden", timeout=30_000)


def screenshot(page, directory: Path, name: str) -> None:
    page.screenshot(path=str(directory / name), full_page=True)


def save_feedback(page) -> None:
    textarea = page.locator("#teacher-feedback-body")
    textarea.wait_for(state="visible", timeout=30_000)
    textarea.fill(FEEDBACK_TEXT)
    page.get_by_label("形成性下一步", exact=True).select_option("REVISE")
    page.get_by_label("支架层级", exact=True).select_option("FOUNDATION")
    prepare = page.get_by_role("button", name="准备确认", exact=True)
    prepare.wait_for(state="visible", timeout=30_000)
    if not prepare.is_enabled():
        raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_FEEDBACK_NOT_READY")
    prepare.click()
    confirm(page, "确认并保存最终反馈", "确认并保存最终反馈")


def main() -> None:
    value = marker()
    base = required("STAGING_BASE_URL").rstrip("/")
    project = required("STAGING_VERCEL_PROJECT_NAME")
    bypass = required("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET")
    if (
        not allowed_vercel_preview(base, project)
        or os.environ.get("STAGING_DEPLOYMENT_PROTECTION_REQUIRED") != "1"
        or not valid_bypass_secret(bypass)
    ):
        fail()
    run(["pnpm", "staging:agent:assert-browser-prerequisites"])
    started = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    from playwright.sync_api import sync_playwright

    directory = output(value)
    directory.mkdir(parents=True, exist_ok=True)
    title = f"CDAS staging Agent acceptance {value}"
    classroom = f"CDAS staging Agent {value}"
    checks: list[dict[str, str]] = []
    pages = []
    browser = None
    contexts = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            for _ in range(4):
                context = browser.new_context(
                    locale="zh-CN",
                    timezone_id="Asia/Taipei",
                    viewport={"width": 1440, "height": 1000},
                )
                install_origin_scoped_bypass(context, base, bypass)
                contexts.append(context)
                page = context.new_page()
                page.set_default_timeout(30_000)
                pages.append(page)
            teacher, student, other_student, other_teacher = pages

            sign_in(teacher, base, "TEACHER")
            checks.append({"code": "VERCEL_PROTECTION_BYPASS_SCOPED", "status": "PASS"})
            teacher.goto(f"{base}/teacher/activities/new", wait_until="domcontentloaded")
            assert_origin(teacher.url, base)
            teacher.locator('#activity-assistant-prompt[data-hydrated="true"]').fill(
                CREATE_PROMPT.format(title=title)
            )
            teacher.get_by_role("button", name="交给助手整理").click()
            draft_approval = teacher.locator('[role="group"][aria-label="任务理解确认"]')
            draft_approval.get_by_role("button", name="确认理解并创建草稿", exact=True).wait_for(timeout=120_000)
            for label in ("教师已提供要求", "明确假设", "跨学科必要性", "目标—任务—证据—评价一致性链"):
                draft_approval.get_by_text(label, exact=True).wait_for()
            draft_approval.get_by_text("math", exact=True).wait_for()
            draft_approval.get_by_text("infoTech", exact=True).wait_for()
            draft_approval.get_by_text("知识与技能", exact=True).wait_for()
            # The proposal is a distinct no-write AgentRun. Capture it before
            # the signed approval continuation creates the editable draft.
            screenshot(teacher, directory, SCREENSHOTS[0])
            teacher.get_by_text("可使用", exact=True).wait_for(timeout=120_000)
            draft_approval.get_by_role("button", name="确认理解并创建草稿", exact=True).click()
            teacher.wait_for_url(re.compile(r"/teacher/activities/.+/preview"), timeout=120_000)
            assert_origin(teacher.url, base)
            teacher.get_by_role("heading", name=title, level=1, exact=True).wait_for()
            teacher.get_by_text("草稿修订 1", exact=True).wait_for()
            for heading in ("基本设置", "背景设定", "三维目标", "总体任务", "任务链", "评价标准"):
                teacher.get_by_role("heading", name=heading, level=3, exact=True).wait_for()
            screenshot(teacher, directory, SCREENSHOTS[1])

            teacher.get_by_role("link", name="← 返回草稿", exact=True).click()
            teacher.wait_for_url(re.compile(r"/teacher/activities/[0-9a-f-]+$"), timeout=30_000)
            teacher.locator('#activity-draft-form[data-hydrated="true"]').wait_for(state="visible")
            teacher.locator("#activity-summary").fill(EDITED_SUMMARY)
            teacher.get_by_role("button", name="保存并标记可预览", exact=True).click()
            preview = teacher.get_by_role("link", name=re.compile("查看发布预览"))
            preview.wait_for(state="visible")
            preview.click()
            teacher.get_by_role("heading", name=title, level=1, exact=True).wait_for()
            teacher.get_by_text("草稿修订 2", exact=True).wait_for()
            teacher.get_by_text(EDITED_SUMMARY, exact=True).wait_for()
            teacher.get_by_role("heading", name="继续核对活动并准备发布").wait_for()
            teacher.locator('#activity-assistant-prompt[data-hydrated="true"]').fill(
                PUBLISH_PROMPT.format(classroom=classroom)
            )
            teacher.get_by_role("button", name="交给助手整理").click()
            approval = teacher.locator('[role="group"][aria-label="发布确认"]')
            approval.get_by_role("button", name="确认并发布", exact=True).wait_for(timeout=120_000)
            approval.get_by_text("版本 2", exact=True).wait_for()
            approval.get_by_text(classroom, exact=True).wait_for()
            approval.get_by_text("未设置截止时间", exact=True).wait_for()
            # The approval part can become visible before the assistant stream
            # emits its final frame. Wait for the idle state so AI SDK can
            # deterministically schedule the approved continuation request.
            teacher.get_by_text("可使用", exact=True).wait_for(timeout=120_000)
            screenshot(teacher, directory, SCREENSHOTS[2])
            approval.get_by_role("button", name="确认并发布", exact=True).click()
            wait_text(teacher, "活动已发布")
            assert_origin(teacher.url, base)
            release_link = teacher.get_by_role("link", name=re.compile("查看.*学生提交")).first
            release_href = release_link.get_attribute("href")
            if not release_href or not re.fullmatch(
                r"/teacher/releases/[0-9a-f-]+/submissions", release_href
            ):
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_RELEASE_LINK_MISSING")
            screenshot(teacher, directory, SCREENSHOTS[3])

            sign_in(student, base, "STUDENT")
            activity_link = student.get_by_role("link", name=f"打开活动：{title}", exact=True)
            activity_href = activity_link.get_attribute("href")
            if not activity_href or not re.fullmatch(r"/student/releases/[0-9a-f-]+", activity_href):
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_STUDENT_LINK_MISSING")
            activity_link.click()
            assert_origin(student.url, base)
            for heading in ("任务设置", "背景设定", "学习目标", "总体任务", "任务链", "评价标准"):
                student.get_by_role("heading", name=heading, level=3, exact=True).wait_for()
            student.locator("#text-evidence").fill(EVIDENCE_TEXT)
            student.get_by_role("button", name="保存草稿", exact=True).click()
            wait_text(student, "草稿已保存")
            student.get_by_role("button", name="正式提交", exact=True).click()
            confirm(student, "确认正式提交？", "确认正式提交")
            wait_text(student, "第 1 版已正式提交")
            screenshot(student, directory, SCREENSHOTS[4])
            denied = student.goto(f"{base}{release_href}", wait_until="domcontentloaded")
            assert_origin(student.url, base)
            if not denied or denied.status != 404:
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_STUDENT_RESOURCE_NOT_HIDDEN")
            checks.append({"code": "STUDENT_TEACHER_RESOURCE_HIDDEN", "status": "PASS"})

            teacher.goto(f"{base}{release_href}", wait_until="domcontentloaded")
            assert_origin(teacher.url, base)
            submission_link = teacher.get_by_role("link", name=re.compile("查看反馈与评价")).first
            submission_href = submission_link.get_attribute("href")
            if not submission_href or not re.fullmatch(r"/teacher/submissions/[0-9a-f-]+", submission_href):
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_SUBMISSION_LINK_MISSING")
            submission_link.click()
            save_feedback(teacher)
            feedback_history = teacher.locator('[aria-labelledby^="feedback-history-"]').last
            feedback_history.get_by_text(FEEDBACK_TEXT, exact=True).wait_for(state="visible")
            feedback_history.get_by_text("形成性下一步：按反馈修改并重交", exact=True).wait_for(state="visible")
            feedback_history.get_by_text("支架层级：基础支持", exact=True).wait_for(state="visible")
            screenshot(teacher, directory, SCREENSHOTS[5])

            sign_in(other_teacher, base, "OTHER_TEACHER")
            denied_release = other_teacher.goto(f"{base}{release_href}", wait_until="domcontentloaded")
            assert_origin(other_teacher.url, base)
            if not denied_release or denied_release.status != 404:
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_OTHER_TEACHER_RELEASE_NOT_HIDDEN")
            checks.append({"code": "OTHER_TEACHER_RELEASE_404", "status": "PASS"})
            denied_submission = other_teacher.goto(f"{base}{submission_href}", wait_until="domcontentloaded")
            assert_origin(other_teacher.url, base)
            if not denied_submission or denied_submission.status != 404:
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_OTHER_TEACHER_SUBMISSION_NOT_HIDDEN")
            other_teacher_text = other_teacher.locator("body").inner_text()
            if EVIDENCE_TEXT in other_teacher_text or FEEDBACK_TEXT in other_teacher_text or required("STAGING_ACCEPTANCE_TEST_STUDENT_NAME") in other_teacher_text:
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_OTHER_TEACHER_RESOURCE_LEAK")
            checks.append({"code": "OTHER_TEACHER_SUBMISSION_404", "status": "PASS"})

            sign_in(other_student, base, "OTHER_STUDENT")
            visible = other_student.goto(f"{base}{activity_href}", wait_until="domcontentloaded")
            assert_origin(other_student.url, base)
            if not visible or visible.status != 200:
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_OTHER_STUDENT_RELEASE_NOT_VISIBLE")
            other_student.get_by_role("heading", name=title, exact=True).wait_for()
            checks.append({"code": "OTHER_STUDENT_RELEASE_VISIBLE", "status": "PASS"})
            other_evidence = other_student.locator("#text-evidence")
            other_evidence.wait_for(state="visible")
            other_student_text = other_student.locator("body").inner_text()
            if other_evidence.input_value() != "" or EVIDENCE_TEXT in other_student_text or FEEDBACK_TEXT in other_student_text or required("STAGING_ACCEPTANCE_TEST_STUDENT_NAME") in other_student_text:
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_OTHER_STUDENT_SUBMISSION_LEAK")
            checks.append({"code": "OTHER_STUDENT_SUBMISSION_CONTENT_HIDDEN", "status": "PASS"})
            denied_other = other_student.goto(f"{base}{submission_href}", wait_until="domcontentloaded")
            assert_origin(other_student.url, base)
            if not denied_other or denied_other.status != 404:
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_OTHER_STUDENT_SUBMISSION_NOT_HIDDEN")
            denied_text = other_student.locator("body").inner_text()
            if EVIDENCE_TEXT in denied_text or FEEDBACK_TEXT in denied_text or required("STAGING_ACCEPTANCE_TEST_STUDENT_NAME") in denied_text:
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_OTHER_STUDENT_SUBMISSION_LEAK")
            checks.append({"code": "OTHER_STUDENT_SUBMISSION_404", "status": "PASS"})

            student.goto(f"{base}{activity_href}", wait_until="domcontentloaded")
            assert_origin(student.url, base)
            wait_text(student, FEEDBACK_TEXT)
            wait_text(student, "按反馈修改并重交")
            wait_text(student, "基础支持")
            student.get_by_role("button", name="开始重交", exact=True).click()
            student.locator("#text-evidence").wait_for(state="visible")
            student.locator("#text-evidence").fill(f"{EVIDENCE_TEXT} stale write after close")
            checks.append({"code": "STUDENT_FEEDBACK_VISIBLE", "status": "PASS"})
            checks.append({"code": "STRUCTURED_FORMATIVE_FEEDBACK_VISIBLE", "status": "PASS"})

            teacher.goto(f"{base}{release_href}", wait_until="domcontentloaded")
            assert_origin(teacher.url, base)
            teacher.get_by_role("button", name="准备关闭活动", exact=True).click()
            confirm(teacher, "确认关闭这个活动", "确认并关闭活动")
            teacher.locator('section[aria-label="关闭活动确认"]').wait_for(state="detached")
            screenshot(teacher, directory, SCREENSHOTS[6])

            student.get_by_role("button", name="保存草稿", exact=True).click()
            wait_text(student, "活动已关闭，当前只能查看现有草稿与正式修订")
            checks.append({"code": "STALE_STUDENT_WRITE_REJECTED_AFTER_CLOSE", "status": "PASS"})
            student.reload(wait_until="domcontentloaded")
            assert_origin(student.url, base)
            wait_text(student, "已关闭 · 唯读")
            readonly = student.locator("#text-evidence")
            readonly.wait_for(state="visible")
            write_buttons = ("保存草稿", "正式提交", "正式迟交", "开始重交")
            if readonly.input_value() != EVIDENCE_TEXT or readonly.is_editable() or any(student.get_by_role("button", name=label, exact=True).count() for label in write_buttons):
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_CLOSED_READONLY_FAILED")
            wait_text(student, FEEDBACK_TEXT)
            checks.append({"code": "CLOSED_STUDENT_READONLY", "status": "PASS"})
            denied_student_page = teacher.goto(f"{base}{activity_href}", wait_until="domcontentloaded")
            assert_origin(teacher.url, base)
            if not denied_student_page or denied_student_page.status != 404:
                raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_TEACHER_STUDENT_RESOURCE_NOT_HIDDEN")
            checks.append({"code": "TEACHER_STUDENT_RESOURCE_HIDDEN", "status": "PASS"})
            screenshot(student, directory, SCREENSHOTS[7])
    except Exception:
        if pages:
            try:
                pages[0].screenshot(path=str(directory / "failure.png"), full_page=True)
            except Exception:
                pass
        raise
    finally:
        for context in contexts:
            try:
                context.close()
            except Exception:
                pass
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass

    completed = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    hashes = {name: hashlib.sha256((directory / name).read_bytes()).hexdigest() for name in SCREENSHOTS}
    browser_codes = [
        "VERCEL_PROTECTION_BYPASS_SCOPED",
        "STUDENT_TEACHER_RESOURCE_HIDDEN",
        "OTHER_TEACHER_RELEASE_404",
        "OTHER_TEACHER_SUBMISSION_404",
        "OTHER_STUDENT_RELEASE_VISIBLE",
        "OTHER_STUDENT_SUBMISSION_CONTENT_HIDDEN",
        "OTHER_STUDENT_SUBMISSION_404",
        "STUDENT_FEEDBACK_VISIBLE",
        "STRUCTURED_FORMATIVE_FEEDBACK_VISIBLE",
        "STALE_STUDENT_WRITE_REJECTED_AFTER_CLOSE",
        "CLOSED_STUDENT_READONLY",
        "TEACHER_STUDENT_RESOURCE_HIDDEN",
    ]
    if [check["code"] for check in checks] != browser_codes:
        raise AcceptanceFailure("STAGING_AGENT_ACCEPTANCE_BROWSER_CHECKS_INVALID")
    evidence = {
        "schema": "staging-agent-acceptance-browser.v1",
        "status": "PASS",
        "startedAt": started,
        "completedAt": completed,
        "checks": [
            *checks,
            *[{"code": f"SCREENSHOT_{index + 1}", "status": "PASS"} for index in range(len(SCREENSHOTS))],
        ],
        "screenshots": hashes,
        "realStudentDataAllowed": False,
        "productionDecision": "NO_GO",
    }
    (directory / "browser.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf8")
    print('{"schema":"staging-agent-acceptance-browser.v1","status":"PASS"}')


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        try:
            value = marker()
            directory = output(value)
            directory.mkdir(parents=True, exist_ok=True)
            failure = directory / "failure.png"
            evidence = {
                "schema": "staging-agent-acceptance-browser.v1",
                "status": "FAIL",
                "checks": [{"code": "STAGING_AGENT_ACCEPTANCE_BROWSER_FAILED", "status": "FAIL"}],
                "screenshots": ({"failure.png": hashlib.sha256(failure.read_bytes()).hexdigest()} if failure.is_file() else {}),
                "realStudentDataAllowed": False,
                "productionDecision": "NO_GO",
            }
            (directory / "browser.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf8")
        except Exception:
            pass
        fail()
