#!/usr/bin/env python3
"""Protected remote synthetic acceptance browser loop; never starts or resets an app/database."""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import urlsplit

from playwright.sync_api import Error as PlaywrightError, Page, sync_playwright


ROOT = Path(__file__).resolve().parents[3]


class AcceptanceFailure(RuntimeError):
    """Only stable, non-sensitive failure codes leave this runner."""


def stable_code(error: BaseException) -> str:
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
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as error:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_BASE_URL_INVALID") from error
    if parsed.scheme != "https" or not parsed.hostname or not is_public_hostname(parsed.hostname) or port == 0 or parsed.path not in {"", "/"} or parsed.query or parsed.fragment or parsed.username is not None or parsed.password is not None:
        raise AcceptanceFailure("STAGING_ACCEPTANCE_BASE_URL_INVALID")
    return raw.rstrip("/")


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
    destination = "teacher" if role == "teacher" else "student"
    ticket = ""
    try:
        page.goto(remote, wait_until="domcontentloaded")
        assert_origin(page.url, remote)
        page.wait_for_function("() => Boolean(window.Clerk?.loaded && window.Clerk.status === 'ready' && window.Clerk.client)", timeout=60_000)
        assert_origin(page.url, remote)
        ticket = issue_ticket(role.upper())
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


def wait_text(page: Page, text: str) -> None:
    page.get_by_text(text, exact=False).last.wait_for(state="visible", timeout=30_000)


def confirm(page: Page, title: str, button: str) -> None:
    dialog = page.get_by_role("dialog").filter(has_text=title)
    dialog.wait_for(state="visible", timeout=30_000)
    dialog.get_by_role("button", name=button, exact=True).click()
    dialog.wait_for(state="hidden", timeout=30_000)


def fill_activity(page: Page, title: str, summary: str) -> None:
    page.locator("#activity-title").fill(title)
    page.locator("#activity-summary").fill(summary)
    page.locator("#activity-learningObjectives").fill("Verify synthetic evidence")
    page.locator("#activity-taskInstructions").fill("Record one synthetic observation and explain it.")
    page.locator("#activity-evidenceRequirements").fill("One non-empty synthetic text evidence")
    page.locator("#activity-feedbackCriteria").fill("Evidence is specific and verifiable")


def feedback(page: Page, body: str) -> None:
    textarea = page.locator("#teacher-feedback-body")
    textarea.wait_for(state="visible", timeout=30_000)
    textarea.fill(body)
    button = page.get_by_role("button", name="准备确认", exact=True)
    button.wait_for(state="visible", timeout=30_000)
    if not button.is_enabled():
        raise AcceptanceFailure("STAGING_ACCEPTANCE_FEEDBACK_NOT_READY")
    button.click()
    confirm(page, "确认并保存最终反馈", "确认并保存最终反馈")


def sign_out_and_relogin(page: Page, remote: str, role: str) -> None:
    page.get_by_role("button", name="退出登录", exact=True).click()
    page.wait_for_url(re.compile(r"/$"), timeout=30_000)
    assert_origin(page.url, remote)
    page.get_by_role("heading", name="开始今天的学习活动", exact=True).wait_for(state="visible")
    page.goto(f"{remote}/{role}", wait_until="domcontentloaded")
    assert_origin(page.url, remote)
    page.get_by_text("需要登录", exact=True).wait_for(state="visible")
    if page.get_by_role("button", name="退出登录", exact=True).count():
        raise AcceptanceFailure("STAGING_ACCEPTANCE_SIGN_OUT_NOT_EFFECTIVE")
    sign_in(page, remote, role)


def run() -> None:
    marker_value = marker()
    remote = base_url()
    if os.environ.get("AI_PROVIDER_DISABLED") != "1":
        raise AcceptanceFailure("STAGING_ACCEPTANCE_AI_NOT_DISABLED")
    assert_browser_prerequisites()
    output = artifacts(marker_value)
    classroom_name = f"CDAS staging synthetic {marker_value}"
    title = f"CDAS staging acceptance {marker_value}"
    evidence = f"Synthetic text evidence for {marker_value}."
    feedback_text = f"Synthetic teacher feedback for {marker_value}."
    index: dict[str, str] = {}
    checks: list[dict[str, str]] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        teacher_context = browser.new_context(locale="zh-CN", timezone_id="Asia/Taipei", viewport={"width": 1440, "height": 1000})
        student_context = browser.new_context(locale="zh-CN", timezone_id="Asia/Taipei", viewport={"width": 1440, "height": 1000})
        teacher = teacher_context.new_page()
        student = student_context.new_page()
        teacher.set_default_timeout(30_000)
        student.set_default_timeout(30_000)
        try:
            sign_in(teacher, remote, "teacher")
            checks.append({"code": "AI_DISABLED_MANUAL_PATH", "status": "PASS"})
            response = teacher.goto(f"{remote}/student", wait_until="domcontentloaded")
            assert_origin(teacher.url, remote)
            if not response or response.status != 200: raise AcceptanceFailure("STAGING_ACCEPTANCE_WRONG_ROLE_GUIDANCE_FAILED")
            teacher.get_by_role("heading", name="当前登录的是教师账号", exact=True).wait_for()
            teacher.get_by_role("link", name="返回教师工作台", exact=True).wait_for()
            if teacher.get_by_text("我的学习活动", exact=True).count(): raise AcceptanceFailure("STAGING_ACCEPTANCE_WRONG_ROLE_LEAK")
            checks.append({"code": "WRONG_ROLE_STUDENT_ROOT_GUIDANCE", "status": "PASS"})
            teacher.goto(f"{remote}/teacher", wait_until="domcontentloaded"); assert_origin(teacher.url, remote)
            sign_out_and_relogin(teacher, remote, "teacher")
            checks.append({"code": "TEACHER_SIGN_OUT_AND_RELOGIN", "status": "PASS"})
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
            teacher.locator("select[name=classroomId]").select_option(label=re.compile(re.escape(classroom_name)))
            teacher.get_by_role("button", name="准备精确发布确认", exact=True).click()
            confirm(teacher, "确认发布活动", "确认并发布")
            wait_text(teacher, "活动已发布")
            assert_origin(teacher.url, remote)
            release = teacher.get_by_role("link", name="查看发布与学生提交", exact=True)
            release_href = release.get_attribute("href")
            if not release_href:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_RELEASE_LINK_MISSING")
            index["02-published.png"] = screenshot(teacher, output, "02-published")

            sign_in(student, remote, "student")
            response = student.goto(f"{remote}/teacher", wait_until="domcontentloaded")
            assert_origin(student.url, remote)
            if not response or response.status != 200: raise AcceptanceFailure("STAGING_ACCEPTANCE_WRONG_ROLE_GUIDANCE_FAILED")
            student.get_by_role("heading", name="当前登录的是学生账号", exact=True).wait_for()
            student.get_by_role("link", name="返回学生工作台", exact=True).wait_for()
            if student.get_by_role("link", name="新建学习活动", exact=True).count(): raise AcceptanceFailure("STAGING_ACCEPTANCE_WRONG_ROLE_LEAK")
            checks.append({"code": "WRONG_ROLE_TEACHER_ROOT_GUIDANCE", "status": "PASS"})
            student.goto(f"{remote}/student", wait_until="domcontentloaded"); assert_origin(student.url, remote)
            sign_out_and_relogin(student, remote, "student")
            checks.append({"code": "STUDENT_SIGN_OUT_AND_RELOGIN", "status": "PASS"})
            activity = student.get_by_role("link", name=f"打开活动：{title}", exact=True)
            activity_href = activity.get_attribute("href")
            if not activity_href:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_STUDENT_LINK_MISSING")
            activity.click()
            assert_origin(student.url, remote)
            student.locator("#text-evidence").fill(evidence)
            student.get_by_role("button", name="保存草稿", exact=True).click()
            wait_text(student, "草稿已保存")
            student.get_by_role("button", name="正式提交", exact=True).click()
            confirm(student, "确认正式提交？", "确认正式提交")
            wait_text(student, "第 1 版已正式提交")
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
            submission = teacher.get_by_role("link", name=re.compile("查看与反馈")).first
            submission_href = submission.get_attribute("href")
            if not submission_href:
                raise AcceptanceFailure("STAGING_ACCEPTANCE_SUBMISSION_LINK_MISSING")
            submission.click()
            assert_origin(teacher.url, remote)
            feedback(teacher, feedback_text)
            teacher.get_by_text(feedback_text, exact=True).wait_for(state="visible")
            index["04-teacher-feedback.png"] = screenshot(teacher, output, "04-teacher-feedback")

            student.goto(f"{remote}{activity_href}", wait_until="domcontentloaded")
            assert_origin(student.url, remote)
            wait_text(student, feedback_text)
            student.get_by_role("button", name="开始重交", exact=True).click()
            student.locator("#text-evidence").wait_for(state="visible")
            student.locator("#text-evidence").fill(f"{evidence} stale write after close")
            checks.append({"code": "STUDENT_FEEDBACK_VISIBLE", "status": "PASS"})

            teacher.goto(f"{remote}{release_href}", wait_until="domcontentloaded")
            assert_origin(teacher.url, remote)
            teacher.get_by_role("button", name="准备关闭活动", exact=True).click()
            confirm(teacher, "确认关闭这个活动", "确认并关闭活动")
            teacher.get_by_role("button", name="准备关闭活动", exact=True).wait_for(state="detached")
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
            checks.append({"code": "CLOSED_STUDENT_READONLY", "status": "PASS"})
            denied = teacher.goto(f"{remote}{activity_href}", wait_until="domcontentloaded")
            assert_origin(teacher.url, remote)
            if not denied or denied.status != 404: raise AcceptanceFailure("STAGING_ACCEPTANCE_TEACHER_STUDENT_RESOURCE_NOT_HIDDEN")
            checks.append({"code": "TEACHER_STUDENT_RESOURCE_HIDDEN", "status": "PASS"})
            index["06-student-closed-readonly.png"] = screenshot(student, output, "06-student-closed-readonly")
        finally:
            teacher_context.close()
            student_context.close()
            browser.close()

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
