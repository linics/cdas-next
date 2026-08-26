#!/usr/bin/env python3
"""Protected remote synthetic acceptance browser loop; never starts or resets an app/database."""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Mapping
from datetime import datetime, timezone
from urllib.parse import urlsplit

from playwright.sync_api import Error as PlaywrightError, Page, sync_playwright


ROOT = Path(__file__).resolve().parents[3]


class AcceptanceFailure(RuntimeError):
    """Only stable, non-sensitive failure codes leave this runner."""


def stable_code(error: BaseException) -> str:
    if isinstance(error, AcceptanceFailure):
        candidate = str(error)
        if re.fullmatch(r"[A-Z0-9_]{3,120}", candidate):
            return candidate
    if isinstance(error, PlaywrightError):
        return "STAGING_ACCEPTANCE_PLAYWRIGHT_TIMEOUT"
    candidate = str(error)
    return candidate if re.fullmatch(r"[A-Z0-9_]{3,120}", candidate) else "STAGING_ACCEPTANCE_BROWSER_FAILED"


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise AcceptanceFailure(f"{name}_REQUIRED")
    return value


def marker() -> str:
    value = required("STAGING_RUN_MARKER")
    if not re.fullmatch(r"cdas-staging-[a-z0-9-]{8,80}", value):
        raise AcceptanceFailure("STAGING_ACCEPTANCE_MARKER_INVALID")
    return value


def base_url() -> str:
    raw = required("STAGING_BASE_URL")
    project = required("STAGING_VERCEL_PROJECT_NAME")
    if not is_allowed_vercel_preview_base_url(raw, project):
        raise AcceptanceFailure("STAGING_ACCEPTANCE_BASE_URL_INVALID")
    return raw.rstrip("/")


def valid_vercel_project_name(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?", value.lower()))


def is_allowed_vercel_preview_base_url(raw: str, project_name: str) -> bool:
    project = project_name.strip().lower()
    if not valid_vercel_project_name(project):
        return False
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as error:
        return False
    hostname = (parsed.hostname or "").lower()
    suffix = ".vercel.app"
    prefix = f"{project}-"
    deployment = hostname[len(prefix):-len(suffix)] if hostname.startswith(prefix) and hostname.endswith(suffix) else ""
    return (
        parsed.scheme == "https"
        and port in {None, 443}
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
        and parsed.username is None
        and parsed.password is None
        and hostname.startswith(prefix)
        and hostname.endswith(suffix)
        and bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,251}[a-z0-9])?", deployment))
        and "." not in deployment
    )


def canonical_origin(value: str) -> str:
    parsed = urlsplit(value)
    port = parsed.port
    if port is None:
        port = 443 if parsed.scheme.lower() == "https" else 80
    hostname = parsed.hostname or ""
    rendered_host = f"[{hostname}]" if ":" in hostname else hostname
    default = (parsed.scheme.lower() == "https" and port == 443) or (parsed.scheme.lower() == "http" and port == 80)
    return f"{parsed.scheme.lower()}://{rendered_host}{'' if default else f':{port}'}"


def exact_origin(candidate: str, expected: str) -> bool:
    try:
        left, right = urlsplit(candidate), urlsplit(expected)
        left_port = left.port
        right_port = right.port
        if left_port is None:
            left_port = 443 if left.scheme.lower() == "https" else 80
        if right_port is None:
            right_port = 443 if right.scheme.lower() == "https" else 80
        return (
            left.scheme.lower() == right.scheme.lower()
            and left.hostname == right.hostname
            and left_port == right_port
            and left.username is None
            and left.password is None
            and right.username is None
            and right.password is None
        )
    except ValueError:
        return False


def valid_vercel_automation_bypass_secret(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9]{32}", value))


def origin_scoped_bypass_headers(
    candidate: str,
    expected: str,
    secret: str,
    headers: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Adds Vercel bypass headers only to the exact protected app origin."""
    if not valid_vercel_automation_bypass_secret(secret):
        raise AcceptanceFailure("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET_INVALID")
    result = {
        name: value
        for name, value in (headers or {}).items()
        if name.lower() not in {
            "x-vercel-protection-bypass",
            "x-vercel-set-bypass-cookie",
        }
    }
    if exact_origin(candidate, expected):
        result["x-vercel-protection-bypass"] = secret
        result["x-vercel-set-bypass-cookie"] = "true"
    return result


def install_origin_scoped_bypass(context, expected: str, secret: str) -> None:
    def continue_request(route) -> None:
        route.continue_(headers=origin_scoped_bypass_headers(
            route.request.url,
            expected,
            secret,
            route.request.headers,
        ))

    context.route("**/*", continue_request)


def assert_origin(candidate: str, expected: str) -> None:
    if not exact_origin(candidate, expected):
        raise AcceptanceFailure("STAGING_ACCEPTANCE_ORIGIN_MISMATCH")


def is_public_hostname(host: str) -> bool:
    normalized = host.lower().rstrip(".")
    if not normalized or normalized == "localhost" or normalized.endswith((".localhost", ".local", ".internal", ".lan")):
        return False
    try:
        address = ipaddress.ip_address(normalized)
        carrier_grade_nat = isinstance(address, ipaddress.IPv4Address) and address in ipaddress.ip_network("100.64.0.0/10")
        return not (address.is_private or address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified or address.is_reserved or carrier_grade_nat)
    except ValueError:
        return bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+", normalized))


def artifacts(marker_value: str) -> Path:
    path = ROOT / "output" / "staging-acceptance" / marker_value
    path.mkdir(parents=True, exist_ok=True)
    return path


def issue_ticket(role: str) -> str:
    result = subprocess.run(
        ["pnpm", "exec", "tsx", "scripts/staging/acceptance/issue-clerk-ticket.ts", role],
        cwd=ROOT,
        env=os.environ.copy(),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_TICKET_ISSUE_FAILED")
    ticket = result.stdout.strip()
    if not ticket or len(ticket) > 16_384 or "\n" in ticket:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_TICKET_INVALID")
    return ticket


def assert_browser_prerequisites() -> None:
    result = subprocess.run(
        ["pnpm", "staging:acceptance:assert-browser-prerequisites"],
        cwd=ROOT,
        env=os.environ.copy(),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_BROWSER_PREREQUISITES_NOT_GO")


def sign_in(page: Page, remote: str, role: str) -> None:
    destination = "teacher" if role in ("teacher", "other_teacher") else "student"
    ticket = ""
    try:
        initial = page.goto(remote, wait_until="domcontentloaded")
        assert_origin(page.url, remote)
        if not initial or initial.status != 200:
            raise AcceptanceFailure("STAGING_ACCEPTANCE_PROTECTED_PREVIEW_INITIAL_REQUEST_FAILED")
        page.wait_for_function("() => Boolean(window.Clerk?.loaded && window.Clerk.status === 'ready' && window.Clerk.client)", timeout=60_000)
        assert_origin(page.url, remote)
        ticket = issue_ticket("OTHER_STUDENT" if role == "other_student" else role.upper())
        page.evaluate(
            """async ({ticket, expectedOrigin}) => {
              if (window.top !== window || window.location.origin !== expectedOrigin) throw new Error('ORIGIN_MISMATCH');
              const clerk = window.Clerk;
              if (!clerk?.loaded || clerk.status !== 'ready' || !clerk.client) throw new Error('CLERK_NOT_READY');
              await clerk.signOut();
              const result = await clerk.client.signIn.create({ strategy: 'ticket', ticket });
              if (result.status !== 'complete' || !result.createdSessionId) throw new Error('CLERK_TICKET_INCOMPLETE');
              await clerk.setActive({ session: result.createdSessionId });
            }""", {"ticket": ticket, "expectedOrigin": canonical_origin(remote)},
        )
        assert_origin(page.url, remote)
        page.goto(f"{remote}/{destination}", wait_until="domcontentloaded")
        assert_origin(page.url, remote)
        if urlsplit(page.url).path != f"/{destination}":
            raise AcceptanceFailure("STAGING_ACCEPTANCE_SIGN_IN_REDIRECT")
    except PlaywrightError as error:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_SIGN_IN_FAILED") from error
    finally:
        # The Python object is the last in-process reference; never log it.
        ticket = ""


def screenshot(page: Page, output: Path, name: str) -> str:
    # Playwright page screenshots contain page pixels only, never browser chrome/URL bars.
    destination = output / f"{name}.png"
    page.screenshot(path=destination, full_page=True)
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def close_quietly(resource: object) -> None:
    """Best-effort browser cleanup must not replace the acceptance failure."""
    try:
        resource.close()
    except Exception:
        pass


def wait_text(page: Page, text: str) -> None:
    page.get_by_text(text, exact=False).last.wait_for(state="visible", timeout=30_000)


def wait_visible(locator: object, code: str) -> None:
    try:
        locator.wait_for(state="visible", timeout=30_000)
    except PlaywrightError as error:
        raise AcceptanceFailure(code) from error


def goto_with_retry(
    page: Page,
    url: str,
    remote: str,
    failure_code: str,
):
    last_error: BaseException | None = None
    for attempt in range(2):
        try:
            response = page.goto(url, wait_until="domcontentloaded")
            assert_origin(page.url, remote)
            return response
        except PlaywrightError as error:
            last_error = error
            if attempt == 0:
                page.wait_for_timeout(2_000)
    raise AcceptanceFailure(failure_code) from last_error


def attachment_download_href(page: Page, filename: str) -> str:
    link = page.locator("li").filter(has_text=filename).get_by_role("link").last
    try:
        link.wait_for(state="visible", timeout=30_000)
    except PlaywrightError as error:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_ATTACHMENT_LINK_MISSING") from error
    href = link.get_attribute("href")
    if not href or not re.fullmatch(r"/attachments/[0-9a-f-]{36}/download", href):
        raise AcceptanceFailure("STAGING_ACCEPTANCE_ATTACHMENT_LINK_INVALID")
    return href


def assert_attachment_download(page: Page, filename: str, expected_sha256: str) -> None:
    link = page.locator("li").filter(has_text=filename).get_by_role("link").last
    with page.expect_download(timeout=30_000) as event:
        link.click()
    download = event.value
    if download.suggested_filename != filename:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_ATTACHMENT_FILENAME_MISMATCH")
    downloaded_path = download.path()
    if not downloaded_path or hashlib.sha256(Path(downloaded_path).read_bytes()).hexdigest() != expected_sha256:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_ATTACHMENT_CONTENT_MISMATCH")


def upload_student_attachment(page: Page, filename: str, payload: bytes) -> None:
    if page.get_by_text("附件存储尚未启用", exact=False).count() > 0:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_ATTACHMENT_STORAGE_DISABLED")
    editor = page.locator('[data-attachment-editor][data-hydrated="true"]')
    wait_visible(editor, "STAGING_ACCEPTANCE_ATTACHMENT_EDITOR_NOT_READY")
    file_input = editor.locator('input[type="file"]')
    try:
        file_input.wait_for(state="attached", timeout=30_000)
    except PlaywrightError as error:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_ATTACHMENT_PICKER_MISSING") from error
    try:
        file_input.set_input_files(
            {
                "name": filename,
                "mimeType": "image/png",
                "buffer": payload,
            }
        )
        page.get_by_text("文件已上传并完成内容验证，可正式提交。", exact=False).last.wait_for(
            state="visible",
            timeout=60_000,
        )
    except PlaywrightError as error:
        body = page.locator("body").inner_text()
        if "附件存储尚未启用" in body:
            raise AcceptanceFailure("STAGING_ACCEPTANCE_ATTACHMENT_STORAGE_DISABLED") from error
        if any(
            token in body
            for token in (
                "无法创建附件",
                "附件上传失败",
                "内容与声明格式不一致",
                "必须小于等于",
            )
        ):
            raise AcceptanceFailure("STAGING_ACCEPTANCE_ATTACHMENT_UPLOAD_FAILED") from error
        raise AcceptanceFailure("STAGING_ACCEPTANCE_ATTACHMENT_UPLOAD_TIMEOUT") from error


def confirm(page: Page, title: str, button: str) -> None:
    dialog = page.get_by_role("dialog").filter(has_text=title)
    dialog.wait_for(state="visible", timeout=30_000)
    dialog.get_by_role("button", name=button, exact=True).click()
    dialog.wait_for(state="hidden", timeout=30_000)


def evaluation_action_failure_code(page: Page, *, save: bool) -> str | None:
    body = page.locator("body").inner_text()
    if "评价确认未能与提交内容对齐" in body:
        return "STAGING_ACCEPTANCE_EVALUATION_PAYLOAD_MISMATCH"
    if "量规评价必须覆盖全部冻结维度" in body:
        return "STAGING_ACCEPTANCE_EVALUATION_INVALID"
    if "当前发布快照没有四档量规" in body:
        return "STAGING_ACCEPTANCE_EVALUATION_RUBRIC_UNAVAILABLE"
    if "确认状态正在变更或已被处理" in body:
        return "STAGING_ACCEPTANCE_EVALUATION_CONCURRENT"
    if "评价尚未保存" in body:
        return (
            "STAGING_ACCEPTANCE_EVALUATION_SAVE_FAILED"
            if save
            else "STAGING_ACCEPTANCE_EVALUATION_PREPARE_FAILED"
        )
    if page.get_by_role("button", name="正在准备…").count():
        return "STAGING_ACCEPTANCE_EVALUATION_PREPARE_HUNG"
    return None


def confirm_evaluation(page: Page) -> None:
    title = "确认并保存量规评价"
    dialog = page.get_by_role("dialog").filter(has_text=title)
    try:
        dialog.wait_for(state="visible", timeout=45_000)
    except PlaywrightError as error:
        raise AcceptanceFailure(
            evaluation_action_failure_code(page, save=False)
            or "STAGING_ACCEPTANCE_EVALUATION_CONFIRM_MISSING"
        ) from error
    dialog.get_by_role("button", name=title, exact=True).click()
    try:
        dialog.wait_for(state="hidden", timeout=30_000)
    except PlaywrightError as error:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_EVALUATION_CONFIRM_STUCK") from error
    code = evaluation_action_failure_code(page, save=True)
    if code:
        raise AcceptanceFailure(code)


def wait_evaluation_history(page: Page, summary: str) -> None:
    history = page.locator('[aria-labelledby^="evaluation-history-"]').last
    try:
        history.get_by_text(summary, exact=True).wait_for(
            state="visible",
            timeout=30_000,
        )
    except PlaywrightError as error:
        raise AcceptanceFailure(
            evaluation_action_failure_code(page, save=True)
            or "STAGING_ACCEPTANCE_EVALUATION_HISTORY_MISSING"
        ) from error
    if history.get_by_text(summary, exact=True).is_visible():
        return
    raise AcceptanceFailure(
        evaluation_action_failure_code(page, save=True)
        or "STAGING_ACCEPTANCE_EVALUATION_HISTORY_MISSING"
    )


def wait_shared_teacher_review(
    page: Page,
    *,
    remote: str,
    activity_href: str,
    feedback_text: str,
    evaluation_text: str,
    release_not_visible_code: str,
    review_not_visible_code: str,
) -> None:
    last_error: BaseException | None = None
    for attempt in range(6):
        response = goto_with_retry(
            page,
            f"{remote}{activity_href}",
            remote,
            release_not_visible_code,
        )
        if not response or response.status != 200:
            raise AcceptanceFailure(release_not_visible_code)
        try:
            page.get_by_text(feedback_text, exact=False).last.wait_for(state="visible", timeout=10_000)
            page.get_by_text("按反馈修改并重交", exact=False).last.wait_for(state="visible", timeout=10_000)
            page.get_by_text("基础支持", exact=False).last.wait_for(state="visible", timeout=10_000)
            page.get_by_text(evaluation_text, exact=False).last.wait_for(state="visible", timeout=10_000)
            page.get_by_text("证据不足", exact=True).last.wait_for(state="visible", timeout=10_000)
            return
        except PlaywrightError as error:
            last_error = error
            if attempt == 5:
                break
            page.wait_for_timeout(2_000)
    raise AcceptanceFailure(review_not_visible_code) from last_error


def fill_activity(page: Page, title: str, summary: str) -> None:
    page.locator('#activity-draft-form[data-hydrated="true"]').wait_for(state="visible")
    page.locator("#activity-title").fill(title)
    page.locator("#activity-summary").fill(summary)
    page.locator("label").filter(has_text="提交模式").locator("select").select_option("phased")
    page.get_by_label("探究主题", exact=True).fill("Synthetic evidence verification")
    page.get_by_label("背景设定", exact=True).fill("Students verify a synthetic campus observation in a real learning context.")
    page.get_by_label("知识与技能目标", exact=True).fill("Identify evidence that can be verified.")
    page.get_by_label("过程与方法目标", exact=True).fill("Compare observations and explain a conclusion.")
    page.get_by_label("情感态度目标", exact=True).fill("Record evidence honestly and respond to peers.")
    page.get_by_label("总体任务说明", exact=True).fill("Record one synthetic observation and explain how it supports a conclusion.")
    for index in range(3):
        phase = page.get_by_role("group", name=f"阶段 {index + 1}", exact=True)
        phase.get_by_label("核心动作", exact=True).fill(f"Complete verification action {index + 1}.")
        phase.get_by_label("情境承接", exact=True).fill(f"Continue the campus verification in stage {index + 1}.")
        phase.get_by_label("学习支架", exact=True).fill("Use the question-evidence-conclusion organizer.")
        phase.get_by_label("提交证据说明", exact=True).fill(f"Stage {index + 1} synthetic text evidence.")
        phase.get_by_label("评价要点", exact=True).fill("Evidence is specific and verifiable.")
    for index in range(4):
        rubric = page.get_by_role("group", name=f"维度 {index + 1}", exact=True)
        rubric.get_by_label("优秀", exact=True).fill("Complete evidence with a clear explanation.")
        rubric.get_by_label("良好", exact=True).fill("Mostly complete evidence and explanation.")
        rubric.get_by_label("合格", exact=True).fill("Basic evidence and an understandable explanation.")
        rubric.get_by_label("需改进", exact=True).fill("Evidence or explanation needs more detail.")


def feedback(page: Page, body: str) -> None:
    textarea = page.locator("#teacher-feedback-body")
    textarea.wait_for(state="visible", timeout=30_000)
    textarea.fill(body)
    page.get_by_label("形成性下一步", exact=True).select_option("REVISE")
    page.get_by_label("支架层级", exact=True).select_option("FOUNDATION")
    button = page.get_by_role("button", name="准备确认", exact=True)
    button.wait_for(state="visible", timeout=30_000)
    if not button.is_enabled():
        raise AcceptanceFailure("STAGING_ACCEPTANCE_FEEDBACK_NOT_READY")
    button.click()
    confirm(page, "确认并保存最终反馈", "确认并保存最终反馈")


def evaluation(page: Page, summary: str, attachment_filename: str) -> None:
    composer = page.locator("section").filter(has=page.locator("#evaluation-editor-title"))
    wait_visible(composer, "STAGING_ACCEPTANCE_EVALUATION_COMPOSER_MISSING")
    dim1 = composer.get_by_role("group", name="维度 1：问题意识")
    dim1.get_by_label("判断方式", exact=True).select_option("LEVEL")
    dim1.get_by_label("达成等级", exact=True).select_option("excellent")
    dim1.get_by_label("引用本版文字证据", exact=True).check()
    dim2 = composer.get_by_role("group", name="维度 2：证据质量")
    dim2.get_by_label("判断方式", exact=True).select_option("INSUFFICIENT_EVIDENCE")
    dim3 = composer.get_by_role("group", name="维度 3：跨学科连接")
    dim3.get_by_label("判断方式", exact=True).select_option("LEVEL")
    dim3.get_by_label("达成等级", exact=True).select_option("good")
    attachment = dim3.get_by_label(f"引用附件 {attachment_filename}", exact=True)
    wait_visible(attachment, "STAGING_ACCEPTANCE_EVALUATION_ATTACHMENT_CITATION_MISSING")
    attachment.check()
    dim4 = composer.get_by_role("group", name="维度 4：方案表达")
    dim4.get_by_label("判断方式", exact=True).select_option("LEVEL")
    dim4.get_by_label("达成等级", exact=True).select_option("pass")
    checkpoint = dim4.get_by_role("checkbox", name=re.compile(r"^引用检查点 1："))
    wait_visible(checkpoint, "STAGING_ACCEPTANCE_EVALUATION_CHECKPOINT_MISSING")
    checkpoint.check()
    textarea = page.locator("#teacher-evaluation-summary")
    textarea.wait_for(state="visible", timeout=30_000)
    textarea.fill(summary)
    button = page.get_by_role("button", name="准备评价确认", exact=True)
    button.wait_for(state="visible", timeout=30_000)
    if not button.is_enabled():
        raise AcceptanceFailure("STAGING_ACCEPTANCE_EVALUATION_NOT_READY")
    button.click()
    confirm_evaluation(page)


def run() -> None:
    marker_value = marker()
    remote = base_url()
    bypass_secret = required("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET")
    if not valid_vercel_automation_bypass_secret(bypass_secret):
        raise AcceptanceFailure("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET_INVALID")
    if os.environ.get("AI_PROVIDER_DISABLED") != "1":
        raise AcceptanceFailure("STAGING_ACCEPTANCE_AI_NOT_DISABLED")
    assert_browser_prerequisites()
    output = artifacts(marker_value)
    classroom_name = f"CDAS staging synthetic {marker_value}"
    title = f"CDAS staging acceptance {marker_value}"
    evidence = f"Synthetic text evidence for {marker_value}."
    phase_one_evidence = f"{evidence} phase 1"
    phase_two_evidence = f"{evidence} phase 2"
    feedback_text = f"Synthetic teacher feedback for {marker_value}."
    evaluation_text = f"Synthetic teacher evaluation for {marker_value}."
    group_name = f"Synthetic group {marker_value}"
    other_student_roster_key = "CDASSTUDENT0002"
    attachment_filename = f"synthetic-{marker_value}.png"
    attachment_bytes = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    attachment_sha256 = hashlib.sha256(attachment_bytes).hexdigest()
    index: dict[str, str] = {}
    checks: list[dict[str, str]] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        teacher_context = browser.new_context(locale="zh-CN", timezone_id="Asia/Taipei", viewport={"width": 1440, "height": 1000})
        student_context = browser.new_context(locale="zh-CN", timezone_id="Asia/Taipei", viewport={"width": 1440, "height": 1000})
        other_student_context = browser.new_context(locale="zh-CN", timezone_id="Asia/Taipei", viewport={"width": 1440, "height": 1000})
        other_teacher_context = browser.new_context(locale="zh-CN", timezone_id="Asia/Taipei", viewport={"width": 1440, "height": 1000})
        for context in (teacher_context, student_context, other_student_context, other_teacher_context):
            install_origin_scoped_bypass(context, remote, bypass_secret)
        teacher = teacher_context.new_page()
        student = student_context.new_page()
        other_student = other_student_context.new_page()
        other_teacher = other_teacher_context.new_page()
        teacher.set_default_timeout(30_000)
        student.set_default_timeout(30_000)
        other_student.set_default_timeout(30_000)
        other_teacher.set_default_timeout(30_000)
        try:
            sign_in(teacher, remote, "teacher")
            checks.append({"code": "VERCEL_PROTECTION_BYPASS_SCOPED", "status": "PASS"})
            checks.append({"code": "AI_DISABLED_MANUAL_PATH", "status": "PASS"})
            response = teacher.goto(f"{remote}/student", wait_until="domcontentloaded")
            assert_origin(teacher.url, remote)
            if not response or response.status != 200: raise AcceptanceFailure("STAGING_ACCEPTANCE_WRONG_ROLE_GUIDANCE_FAILED")
            teacher.get_by_role("heading", name="当前登录的是教师账号", exact=True).wait_for()
            teacher.get_by_role("link", name="返回教师工作台", exact=True).wait_for()
            if teacher.get_by_text("我的学习活动", exact=True).count(): raise AcceptanceFailure("STAGING_ACCEPTANCE_WRONG_ROLE_LEAK")
            checks.append({"code": "WRONG_ROLE_STUDENT_ROOT_GUIDANCE", "status": "PASS"})
            teacher.goto(f"{remote}/teacher", wait_until="domcontentloaded"); assert_origin(teacher.url, remote)
            classroom_row = teacher.locator("article").filter(has_text=classroom_name)
            members_href = classroom_row.get_by_role("link", name="管理成员 →", exact=True).get_attribute("href")
            if not members_href or not re.fullmatch(r"/teacher/classrooms/[0-9a-f-]+/members", members_href):
                raise AcceptanceFailure("STAGING_ACCEPTANCE_MEMBER_LINK_MISSING")
            teacher.get_by_role("link", name="新建学习活动", exact=True).click()
            teacher.wait_for_url(re.compile(r"/teacher/activities/new$"))
            assert_origin(teacher.url, remote)
            fill_activity(teacher, title, f"Synthetic-only acceptance evidence for {marker_value}.")
            teacher.get_by_role("button", name="保存并标记可预览", exact=True).click()
            preview = teacher.get_by_role("link", name=re.compile("查看发布预览"))
            preview.wait_for(state="visible")
            index["01-draft-ready.png"] = screenshot(teacher, output, "01-draft-ready")
            preview.click()
            assert_origin(teacher.url, remote)
            for heading in ("基本设置", "背景设定", "三维目标", "总体任务", "任务链", "评价标准"):
                teacher.get_by_role("heading", name=heading, level=3, exact=True).wait_for()
            teacher.locator("select[name=classroomId]").select_option(label=f"{classroom_name} · 2 名当前成员")
            teacher.get_by_role("button", name="准备精确发布确认", exact=True).click()
            confirm(teacher, "确认发布活动", "确认并发布")
            wait_text(teacher, "活动已发布")
            assert_origin(teacher.url, remote)
            release = teacher.get_by_role("link", name="查看发布与学生提交", exact=True)
            release_href = release.get_attribute("href")
            if not release_href:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_RELEASE_LINK_MISSING")
            index["02-published.png"] = screenshot(teacher, output, "02-published")

            try:
                teacher.goto(f"{remote}{release_href}", wait_until="domcontentloaded")
                assert_origin(teacher.url, remote)
                teacher.locator('[data-hydrated="true"][aria-labelledby="release-groups-title"]').wait_for(state="visible")
                teacher.get_by_role("button", name="新建作业小组", exact=True).click()
                teacher.get_by_label("小组名称", exact=True).fill(group_name)
                primary_name = required("STAGING_ACCEPTANCE_TEST_STUDENT_NAME")
                groupmate_name = required("STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME")
                teacher.get_by_role("checkbox", name=primary_name, exact=True).check()
                teacher.get_by_role("checkbox", name=groupmate_name, exact=True).check()
                teacher.get_by_label(f"{primary_name}的组内角色", exact=True).fill("记录")
                teacher.get_by_label(f"{groupmate_name}的组内角色", exact=True).fill("汇报")
                teacher.get_by_role("button", name="准备创建小组", exact=True).click()
                confirm(teacher, "确认共享提交分组", "确认分组")
                wait_text(teacher, group_name)
                wait_text(teacher, "可编辑")
            except PlaywrightError as error:
                screenshot(teacher, output, "02a-group-configuration-failed")
                raise AcceptanceFailure("STAGING_ACCEPTANCE_GROUP_CONFIGURATION_UI_FAILED") from error
            checks.append({"code": "TEACHER_GROUP_CONFIGURED", "status": "PASS"})

            sign_in(student, remote, "student")
            response = student.goto(f"{remote}/teacher", wait_until="domcontentloaded")
            assert_origin(student.url, remote)
            if not response or response.status != 200: raise AcceptanceFailure("STAGING_ACCEPTANCE_WRONG_ROLE_GUIDANCE_FAILED")
            student.get_by_role("heading", name="当前登录的是学生账号", exact=True).wait_for()
            student.get_by_role("link", name="返回学生工作台", exact=True).wait_for()
            if student.get_by_role("link", name="新建学习活动", exact=True).count(): raise AcceptanceFailure("STAGING_ACCEPTANCE_WRONG_ROLE_LEAK")
            checks.append({"code": "WRONG_ROLE_TEACHER_ROOT_GUIDANCE", "status": "PASS"})
            student.goto(f"{remote}/student", wait_until="domcontentloaded"); assert_origin(student.url, remote)
            activity = student.get_by_role("link", name=f"打开活动：{title}", exact=True)
            activity_href = activity.get_attribute("href")
            if not activity_href:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_STUDENT_LINK_MISSING")
            activity.click()
            assert_origin(student.url, remote)
            for heading in ("任务设置", "背景设定", "学习目标", "总体任务", "任务链", "评价标准"):
                student.get_by_role("heading", name=heading, level=3, exact=True).wait_for()
            student.get_by_text("第 1 阶段", exact=True).wait_for(state="visible")
            if student.locator('[data-locked="true"]').filter(has_text="调查与分析").count() != 1:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_PHASE_ORDER_NOT_LOCKED")
            student.get_by_role("checkbox", name=re.compile("Stage 1 synthetic text evidence")).check()
            student.locator("#text-evidence").fill(phase_one_evidence)
            student.get_by_role("button", name="保存草稿", exact=True).click()
            wait_text(student, "草稿已保存")
            student.get_by_role("button", name="正式提交", exact=True).click()
            confirm(student, "确认正式提交？", "确认正式提交")
            wait_text(student, "下一阶段草稿已经准备好")

            sign_in(other_student, remote, "other_student")
            groupmate_visible = other_student.goto(f"{remote}{activity_href}", wait_until="domcontentloaded")
            assert_origin(other_student.url, remote)
            if not groupmate_visible or groupmate_visible.status != 200:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_GROUPMATE_RELEASE_NOT_VISIBLE")
            other_student.get_by_role("heading", name=group_name, exact=True).wait_for(state="visible")
            wait_text(other_student, f"{primary_name}（记录）")
            wait_text(other_student, f"{groupmate_name}（汇报）")
            other_student.locator(f'a[href="{activity_href}?phase=1"]').click()
            wait_text(other_student, phase_one_evidence)
            other_student.locator(f'a[href="{activity_href}?phase=2"]').click()
            other_student.get_by_text("第 2 阶段", exact=True).wait_for(state="visible")
            other_student.get_by_role("checkbox", name=re.compile("Stage 2 synthetic text evidence")).check()
            other_student.locator("#text-evidence").fill(phase_two_evidence)
            other_student.get_by_role("button", name="保存草稿", exact=True).click()
            wait_text(other_student, "草稿已保存")
            other_student.get_by_role("button", name="正式提交", exact=True).click()
            confirm(other_student, "确认正式提交？", "确认正式提交")
            wait_text(other_student, "下一阶段草稿已经准备好")
            checks.append({"code": "GROUPMATE_SHARED_PHASE_WRITE", "status": "PASS"})

            student.goto(f"{remote}{activity_href}", wait_until="domcontentloaded")
            assert_origin(student.url, remote)
            student.locator(f'a[href="{activity_href}?phase=2"]').click()
            wait_text(student, phase_two_evidence)
            student.locator(f'a[href="{activity_href}?phase=3"]').click()
            student.get_by_text("第 3 阶段", exact=True).wait_for(state="visible")
            student.get_by_role("checkbox", name=re.compile("Stage 3 synthetic text evidence")).check()
            student.locator("#text-evidence").fill(evidence)
            student.get_by_role("button", name="保存草稿", exact=True).click()
            wait_text(student, "草稿已保存")
            student.reload(wait_until="domcontentloaded")
            assert_origin(student.url, remote)
            student.get_by_text("第 3 阶段", exact=True).wait_for(state="visible")
            upload_student_attachment(student, attachment_filename, attachment_bytes)
            attachment_href = attachment_download_href(student, attachment_filename)
            assert_attachment_download(student, attachment_filename, attachment_sha256)
            checks.append({"code": "STUDENT_PRIVATE_ATTACHMENT_UPLOAD_AND_DOWNLOAD", "status": "PASS"})
            student.get_by_role("button", name="正式提交", exact=True).click()
            confirm(student, "确认正式提交？", "确认正式提交")
            wait_text(student, "第 1 版已正式提交")
            student.get_by_text("第 3/3 阶段", exact=True).wait_for(state="visible")
            checks.append({"code": "SEQUENTIAL_PHASE_EXECUTION", "status": "PASS"})
            denied = student.goto(f"{remote}{release_href}", wait_until="domcontentloaded")
            assert_origin(student.url, remote)
            if not denied or denied.status != 404:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_STUDENT_RESOURCE_NOT_HIDDEN")
            checks.append({"code": "STUDENT_TEACHER_RESOURCE_HIDDEN", "status": "PASS"})
            student.goto(f"{remote}{activity_href}", wait_until="domcontentloaded")
            assert_origin(student.url, remote)
            index["03-student-submitted.png"] = screenshot(student, output, "03-student-submitted")

            teacher.goto(f"{remote}{release_href}", wait_until="domcontentloaded")
            assert_origin(teacher.url, remote)
            wait_visible(
                teacher.get_by_role("heading", name=title, exact=True),
                "STAGING_ACCEPTANCE_TEACHER_RELEASE_NOT_VISIBLE",
            )
            submission = teacher.get_by_role("link", name=re.compile("查看反馈与评价")).first
            wait_visible(submission, "STAGING_ACCEPTANCE_SUBMISSION_LINK_MISSING")
            submission_href = submission.get_attribute("href")
            if not submission_href:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_SUBMISSION_LINK_MISSING")
            submission.click()
            assert_origin(teacher.url, remote)
            if attachment_download_href(teacher, attachment_filename) != attachment_href:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_ATTACHMENT_LINK_CHANGED")
            assert_attachment_download(teacher, attachment_filename, attachment_sha256)
            checks.append({"code": "TEACHER_FORMAL_ATTACHMENT_DOWNLOAD", "status": "PASS"})
            feedback(teacher, feedback_text)
            teacher.locator('[aria-labelledby^="feedback-history-"]').last.get_by_text(
                feedback_text,
                exact=True,
            ).wait_for(state="visible")
            teacher.locator('[aria-labelledby^="feedback-history-"]').last.get_by_text(
                "形成性下一步：按反馈修改并重交",
                exact=True,
            ).wait_for(state="visible")
            teacher.locator('[aria-labelledby^="feedback-history-"]').last.get_by_text(
                "支架层级：基础支持",
                exact=True,
            ).wait_for(state="visible")
            evaluation(teacher, evaluation_text, attachment_filename)
            wait_evaluation_history(teacher, evaluation_text)
            teacher.locator('[aria-labelledby^="evaluation-history-"]').last.get_by_text(
                "证据不足",
                exact=True,
            ).wait_for(state="visible")
            teacher.locator('[aria-labelledby^="evaluation-history-"]').last.get_by_text(
                "优秀",
                exact=True,
            ).wait_for(state="visible")
            checks.append({"code": "EVIDENCE_BOUND_EVALUATION_VISIBLE", "status": "PASS"})
            index["04-teacher-feedback.png"] = screenshot(teacher, output, "04-teacher-feedback")
            teacher.goto(f"{remote}{release_href}", wait_until="domcontentloaded")
            assert_origin(teacher.url, remote)
            wait_visible(
                teacher.get_by_text("已评价 v1", exact=False).last,
                "STAGING_ACCEPTANCE_TEACHER_EVALUATION_SUMMARY_MISSING",
            )
            wait_visible(
                teacher.get_by_text("已反馈 1/3", exact=False),
                "STAGING_ACCEPTANCE_REVIEW_COVERAGE_MISSING",
            )
            wait_visible(
                teacher.get_by_text("已评价 1/3", exact=False),
                "STAGING_ACCEPTANCE_REVIEW_COVERAGE_MISSING",
            )
            checks.append({"code": "REVIEW_COVERAGE_VISIBLE", "status": "PASS"})
            wait_visible(
                teacher.get_by_text("待重交", exact=False),
                "STAGING_ACCEPTANCE_FOLLOW_UP_MISSING",
            )
            checks.append({"code": "FOLLOW_UP_VISIBLE", "status": "PASS"})

            sign_in(other_teacher, remote, "other_teacher")
            wait_visible(
                other_teacher.get_by_text(
                    required("STAGING_ACCEPTANCE_TEST_OTHER_TEACHER_NAME"),
                    exact=False,
                ).first,
                "STAGING_ACCEPTANCE_OTHER_TEACHER_SIGN_IN_NOT_STABLE",
            )
            denied_release = goto_with_retry(
                other_teacher,
                f"{remote}{release_href}",
                remote,
                "STAGING_ACCEPTANCE_OTHER_TEACHER_RELEASE_NAVIGATION_FAILED",
            )
            if not denied_release or denied_release.status != 404:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_OTHER_TEACHER_RELEASE_NOT_HIDDEN")
            checks.append({"code": "OTHER_TEACHER_RELEASE_404", "status": "PASS"})
            denied_submission = goto_with_retry(
                other_teacher,
                f"{remote}{submission_href}",
                remote,
                "STAGING_ACCEPTANCE_OTHER_TEACHER_SUBMISSION_NAVIGATION_FAILED",
            )
            if not denied_submission or denied_submission.status != 404:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_OTHER_TEACHER_SUBMISSION_NOT_HIDDEN")
            other_teacher_text = other_teacher.locator("body").inner_text()
            if evidence in other_teacher_text or feedback_text in other_teacher_text or evaluation_text in other_teacher_text or required("STAGING_ACCEPTANCE_TEST_STUDENT_NAME") in other_teacher_text:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_OTHER_TEACHER_RESOURCE_LEAK")
            checks.append({"code": "OTHER_TEACHER_SUBMISSION_404", "status": "PASS"})

            # The groupmate last viewed phase 2. Select the reviewed phase
            # explicitly instead of relying on the route's default phase.
            review_href = f"{activity_href}?phase=3"
            visible = goto_with_retry(
                other_student,
                f"{remote}{review_href}",
                remote,
                "STAGING_ACCEPTANCE_GROUPMATE_RELEASE_NOT_VISIBLE",
            )
            if not visible or visible.status != 200:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_GROUPMATE_RELEASE_NOT_VISIBLE")
            wait_visible(
                other_student.get_by_role("heading", name=title, exact=True),
                "STAGING_ACCEPTANCE_GROUPMATE_RELEASE_TITLE_MISSING",
            )
            wait_visible(
                other_student.get_by_role("heading", name=group_name, exact=True),
                "STAGING_ACCEPTANCE_GROUPMATE_GROUP_MISSING",
            )
            wait_visible(
                other_student.get_by_text(evidence, exact=False).last,
                "STAGING_ACCEPTANCE_GROUPMATE_EVIDENCE_NOT_VISIBLE",
            )
            wait_shared_teacher_review(
                other_student,
                remote=remote,
                activity_href=review_href,
                feedback_text=feedback_text,
                evaluation_text=evaluation_text,
                release_not_visible_code="STAGING_ACCEPTANCE_GROUPMATE_RELEASE_NOT_VISIBLE",
                review_not_visible_code="STAGING_ACCEPTANCE_GROUPMATE_REVIEW_NOT_VISIBLE",
            )
            if attachment_download_href(other_student, attachment_filename) != attachment_href:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_GROUPMATE_ATTACHMENT_LINK_CHANGED")
            assert_attachment_download(other_student, attachment_filename, attachment_sha256)
            checks.append({"code": "GROUPMATE_SHARED_SUBMISSION_VISIBLE", "status": "PASS"})
            checks.append({"code": "GROUPMATE_SHARED_FEEDBACK_VISIBLE", "status": "PASS"})
            checks.append({"code": "GROUPMATE_SHARED_ATTACHMENT_DOWNLOAD", "status": "PASS"})
            denied_other = other_student.goto(f"{remote}{submission_href}", wait_until="domcontentloaded")
            assert_origin(other_student.url, remote)
            if not denied_other or denied_other.status != 404:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_GROUPMATE_TEACHER_RESOURCE_NOT_HIDDEN")
            denied_text = other_student.locator("body").inner_text()
            if evidence in denied_text or feedback_text in denied_text or evaluation_text in denied_text:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_GROUPMATE_TEACHER_RESOURCE_LEAK")
            checks.append({"code": "GROUPMATE_TEACHER_SUBMISSION_404", "status": "PASS"})

            wait_shared_teacher_review(
                student,
                remote=remote,
                activity_href=review_href,
                feedback_text=feedback_text,
                evaluation_text=evaluation_text,
                release_not_visible_code="STAGING_ACCEPTANCE_STUDENT_RELEASE_NOT_VISIBLE",
                review_not_visible_code="STAGING_ACCEPTANCE_STUDENT_REVIEW_NOT_VISIBLE",
            )
            student.goto(f"{remote}/student", wait_until="domcontentloaded")
            assert_origin(student.url, remote)
            wait_text(student, "已有评价")
            wait_text(student, "当前版已有量规评价")
            if evaluation_text in student.locator("body").inner_text():
                raise AcceptanceFailure("STAGING_ACCEPTANCE_STUDENT_LIST_EVALUATION_LEAK")
            student.goto(f"{remote}{activity_href}", wait_until="domcontentloaded")
            assert_origin(student.url, remote)
            wait_text(student, evaluation_text)
            student.get_by_role("button", name="开始重交", exact=True).click()
            student.locator("#text-evidence").wait_for(state="visible")
            student.locator("#text-evidence").fill(f"{evidence} stale write after close")
            checks.append({"code": "STUDENT_FEEDBACK_VISIBLE", "status": "PASS"})
            checks.append({"code": "STRUCTURED_FORMATIVE_FEEDBACK_VISIBLE", "status": "PASS"})

            teacher.goto(f"{remote}{release_href}", wait_until="domcontentloaded")
            assert_origin(teacher.url, remote)
            teacher.get_by_role("button", name="准备关闭活动", exact=True).click()
            confirm(teacher, "确认关闭这个活动", "确认并关闭活动")
            teacher.locator('section[aria-label="关闭活动确认"]').wait_for(
                state="detached",
            )
            index["05-teacher-closed.png"] = screenshot(teacher, output, "05-teacher-closed")

            # This stale form posts through the existing Server Action after the
            # close transaction, proving the command (not just UI hiding) rejects it.
            student.get_by_role("button", name="保存草稿", exact=True).click()
            wait_text(student, "活动已关闭，当前只能查看现有草稿与正式修订")
            checks.append({"code": "STALE_STUDENT_WRITE_REJECTED_AFTER_CLOSE", "status": "PASS"})
            student.reload(wait_until="domcontentloaded")
            assert_origin(student.url, remote)
            wait_text(student, "已关闭 · 唯读")
            readonly = student.locator("#text-evidence")
            readonly.wait_for(state="visible")
            if readonly.input_value() != evidence or readonly.is_editable() or any(student.get_by_role("button", name=label, exact=True).count() for label in ("保存草稿", "正式提交", "正式迟交", "开始重交")):
                raise AcceptanceFailure("STAGING_ACCEPTANCE_CLOSED_READONLY_FAILED")
            wait_text(student, feedback_text)
            wait_text(student, evaluation_text)
            if attachment_download_href(student, attachment_filename) != attachment_href:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_CLOSED_ATTACHMENT_LINK_CHANGED")
            assert_attachment_download(student, attachment_filename, attachment_sha256)
            checks.append({"code": "CLOSED_STUDENT_ATTACHMENT_READABLE", "status": "PASS"})
            checks.append({"code": "CLOSED_STUDENT_READONLY", "status": "PASS"})
            denied = teacher.goto(f"{remote}{activity_href}", wait_until="domcontentloaded")
            assert_origin(teacher.url, remote)
            if not denied or denied.status != 404: raise AcceptanceFailure("STAGING_ACCEPTANCE_TEACHER_STUDENT_RESOURCE_NOT_HIDDEN")
            checks.append({"code": "TEACHER_STUDENT_RESOURCE_HIDDEN", "status": "PASS"})
            index["06-student-closed-readonly.png"] = screenshot(student, output, "06-student-closed-readonly")

            teacher.goto(f"{remote}{members_href}", wait_until="domcontentloaded")
            assert_origin(teacher.url, remote)
            teacher.locator('#classroom-roster-manager[data-hydrated="true"]').wait_for(state="visible")
            other_name = required("STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME")
            current_row = teacher.locator("article").filter(has_text=other_name).filter(has=teacher.get_by_role("button", name="结束成员关系", exact=True))
            current_row.get_by_role("button", name="结束成员关系", exact=True).click()
            confirm(teacher, "确认结束成员关系", "确认结束关系")
            wait_text(teacher, "班级成员关系已更新，历史区间已保留。")
            teacher.reload(wait_until="domcontentloaded")
            teacher.locator('#classroom-roster-manager[data-hydrated="true"]').wait_for(state="visible")
            teacher.get_by_text("历史成员区间", exact=True).wait_for(state="visible")
            teacher.get_by_label("学生名单码", exact=True).fill(other_student_roster_key)
            teacher.get_by_role("button", name="预览名单", exact=True).click()
            teacher.get_by_text(f"{other_name} · 可加入", exact=True).wait_for(state="visible")
            teacher.get_by_role("button", name="准备加入 1 名学生", exact=True).click()
            confirm(teacher, "确认加入班级成员", "确认加入")
            wait_text(teacher, "班级成员关系已更新，历史区间已保留。")
            teacher.reload(wait_until="domcontentloaded")
            current_roster = teacher.locator('section[aria-labelledby="current-roster-title"]')
            if current_roster.locator("header").get_by_text("2 名", exact=True).count() != 1:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_MEMBER_REJOIN_COUNT_FAILED")
            checks.append({"code": "TEACHER_MEMBER_END_AND_REJOIN", "status": "PASS"})
        except BaseException:
            for page, name in (
                (teacher, "fail-teacher"),
                (student, "fail-student"),
                (other_student, "fail-other-student"),
                (other_teacher, "fail-other-teacher"),
            ):
                try:
                    screenshot(page, output, name)
                except Exception:
                    pass
            raise
        finally:
            close_quietly(teacher_context)
            close_quietly(student_context)
            close_quietly(other_student_context)
            close_quietly(other_teacher_context)
            close_quietly(browser)

    payload = {
        "schema": "staging-synthetic-acceptance-evidence.v1",
        "status": "PASS",
        "runMarker": marker_value,
        "githubRunId": required("GITHUB_RUN_ID"),
        "githubRunAttempt": required("GITHUB_RUN_ATTEMPT"),
        "deploymentId": required("CDAS_DEPLOYMENT_ID"),
        "sourceFingerprint": required("CDAS_SOURCE_FINGERPRINT"),
        "fixtureNamespace": {"classroomDerived": True, "marker": marker_value},
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "checks": checks,
        "artifactSha256": index,
        "realStudentDataAllowed": False,
        "productionDecision": "NO_GO",
    }
    (output / "evidence.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"schema": payload["schema"], "status": "PASS"}))


if __name__ == "__main__":
    try:
        run()
    except BaseException as error:
        marker_value = os.environ.get("STAGING_RUN_MARKER", "").strip()
        if re.fullmatch(r"cdas-staging-[a-z0-9-]{8,80}", marker_value):
            destination = artifacts(marker_value) / "evidence.json"
            destination.write_text(json.dumps({"schema": "staging-synthetic-acceptance-evidence.v1", "status": "FAIL", "checks": [{"code": stable_code(error), "status": "FAIL"}], "realStudentDataAllowed": False, "productionDecision": "NO_GO"}, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"schema": "staging-synthetic-acceptance-evidence.v1", "status": "FAIL", "code": stable_code(error)}))
        sys.exit(1)
