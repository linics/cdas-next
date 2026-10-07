#!/usr/bin/env python3
"""Run the local-auth, isolated-PostgreSQL CDAS browser closed loop."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import urlparse

from playwright.sync_api import (
    Error as PlaywrightError,
    Locator,
    Page,
    TimeoutError as PlaywrightTimeoutError,
    sync_playwright,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_E2E_DATABASE_URL = (
    "postgresql://postgres:postgres@127.0.0.1:5434/cdas_next_e2e"
)
DEFAULT_BASE_URL = "http://localhost:3100"
FOREIGN_DRAFT_ID = "30000000-0000-4000-8000-000000000001"


class E2eFailure(RuntimeError):
    """A stable, credential-free browser-gate failure."""


def assert_origin(page: Page, base_url: str) -> None:
    expected = urlparse(base_url)
    actual = urlparse(page.url)
    if actual.scheme != expected.scheme or actual.netloc != expected.netloc:
        raise E2eFailure("E2E_ORIGIN_CHANGED")


def redact_sensitive_text(value: str) -> str:
    value = re.sub(
        r"(?i)(token=)[^&\s\"\\]+",
        r"\1[REDACTED]",
        value,
    )
    value = re.sub(
        r"\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+\b",
        "[REDACTED_PROVIDER_KEY]",
        value,
    )
    return value


def sanitize_server_log(path: Path) -> None:
    if not path.exists():
        return
    sanitized = redact_sensitive_text(path.read_text(encoding="utf-8"))
    path.write_text(sanitized, encoding="utf-8")


def run_marker(*, real_model_smoke: bool) -> str:
    timestamp = time.strftime("%Y%m%d%H%M%S", time.gmtime())
    prefix = "cdas-e2e-ai" if real_model_smoke else "cdas-e2e"
    return f"{prefix}-{timestamp}-{secrets.token_hex(3)}"


def use_real_model_smoke() -> bool:
    arguments = sys.argv[1:]
    if not arguments:
        return False
    if arguments == ["--real-model-smoke"]:
        return True
    raise E2eFailure("E2E_ARGUMENTS_INVALID")


def local_e2e_database_url(environment: dict[str, str]) -> tuple[str, int]:
    value = environment.get("E2E_DATABASE_URL", DEFAULT_E2E_DATABASE_URL)
    parsed = urlparse(value)
    if (
        parsed.scheme not in {"postgresql", "postgres"}
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.path != "/cdas_next_e2e"
        or parsed.fragment
    ):
        raise E2eFailure("E2E_DATABASE_MUST_BE_LOCAL_DEDICATED_TARGET")
    return value, parsed.port or 5432


def run_command(
    arguments: list[str],
    *,
    environment: dict[str, str],
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        arguments,
        cwd=REPOSITORY_ROOT,
        env=environment,
        check=True,
        text=True,
        capture_output=capture_output,
    )


def wait_for_server(base_url: str, process: subprocess.Popen[str]) -> None:
    target = urlparse(base_url)
    if not target.hostname or not target.port:
        raise E2eFailure("E2E_BASE_URL_INVALID")
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise E2eFailure("NEXT_SERVER_EXITED_BEFORE_READY")
        try:
            with socket.create_connection(
                (target.hostname, target.port), timeout=1
            ):
                return
        except OSError:
            pass
        time.sleep(0.5)
    raise E2eFailure("NEXT_SERVER_READY_TIMEOUT")


def stop_server(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def wait_for_text(page: Page, value: str | re.Pattern[str]) -> None:
    page.get_by_text(value, exact=False).last.wait_for(state="visible", timeout=30_000)


def dialog_titled(page: Page, title: str) -> Locator:
    # Confirmations are alert dialogs (they interrupt to ask for a decision);
    # plain dialogs are matched too so a change of primitive is not a failure.
    return page.locator('[role="alertdialog"], [role="dialog"]').filter(
        has_text=title
    )


def confirm_dialog(page: Page, title: str, confirmation_label: str) -> None:
    dialog = dialog_titled(page, title)
    dialog.wait_for(state="visible", timeout=30_000)
    dialog.get_by_role("button", name=confirmation_label, exact=True).click()
    dialog.wait_for(state="hidden", timeout=30_000)


def switch_account(
    page: Page,
    base_url: str,
    role: str,
    credentials: dict[str, dict[str, str]],
) -> None:
    destination = "teacher" if role == "teacher" else "student"
    identity = credentials[role]
    page.context.clear_cookies()
    page.goto(f"{base_url}/{destination}/login", wait_until="domcontentloaded")
    assert_origin(page, base_url)
    try:
        page.get_by_label("学校代码", exact=True).fill(identity["schoolCode"])
        field = "工号" if role == "teacher" else "学号"
        page.get_by_label(field, exact=True).fill(identity["account"])
        page.get_by_label("密码", exact=True).fill(identity["password"])
        page.get_by_role("button", name="进入工作台", exact=True).click()
        # The login form is rendered in place on the workspace route itself
        # (the /login path redirects there), so the URL already matches before
        # the session exists, and the button renames itself while pending. The
        # password field leaving the page is what proves the login landed.
        page.get_by_label("密码", exact=True).wait_for(
            state="detached", timeout=30_000
        )
        page.wait_for_url(f"{base_url}/{destination}", timeout=30_000)
        assert_origin(page, base_url)
        session = next(
            (cookie for cookie in page.context.cookies() if cookie["name"] == "cdas_session"),
            None,
        )
        if not session or not session.get("value"):
            raise E2eFailure("LOCAL_SESSION_COOKIE_MISSING")
        if session.get("httpOnly") is not True:
            raise E2eFailure("LOCAL_SESSION_COOKIE_NOT_HTTP_ONLY")
        if session.get("sameSite") != "Lax":
            raise E2eFailure("LOCAL_SESSION_COOKIE_SAMESITE_INVALID")
        if session.get("secure") is not False:
            raise E2eFailure("LOCAL_SESSION_COOKIE_SECURE_INVALID")
    except Exception:
        try:
            page.get_by_label("密码", exact=True).fill("")
        except PlaywrightError:
            pass
        raise


def open_confirmed_records(page: Page) -> None:
    summary = page.locator("summary").filter(has_text="已保存的记录")
    summary.wait_for(state="visible", timeout=30_000)
    if not summary.evaluate("element => element.parentElement.open"):
        summary.click()


def assert_stop_control_exists(page: Page) -> None:
    """Prove the settle guard's locator is real, while a stream is in flight.

    `settle_assistant_stream` waits for the stop control to go, and a wait for
    something to vanish passes trivially when the selector matches nothing. That
    is how five settle guards silently did nothing for the life of this script:
    they looked for a button named 「停止」 while it is named 「停止生成」, so
    every wait returned instantly and the script navigated through live streams.

    Checking existence has to happen where streaming is guaranteed — right after
    submitting — because by the time a turn's result has been asserted it may
    legitimately be finished and the control legitimately gone.
    """
    page.get_by_role("button", name="停止生成", exact=True).wait_for(
        state="attached", timeout=30_000
    )


def settle_assistant_stream(page: Page) -> None:
    """Wait for the assistant turn to finish before navigating away.

    Navigating mid-stream aborts the request and leaves a CANCELLED AgentRun
    that says nothing about what the turn actually did.

    Deliberately tolerant of a turn that has already finished: the control is
    gone either way. `assert_stop_control_exists` is what keeps this honest.
    """
    page.get_by_role("button", name="停止生成", exact=True).wait_for(
        state="detached", timeout=120_000
    )


def screenshot(page: Page, artifacts: Path, name: str) -> None:
    page.screenshot(path=artifacts / f"{name}.png", full_page=True)


def form_field(scope: Page | Locator, label: str) -> Locator:
    """The control wrapped by a label whose text starts with `label`.

    The v3 form wraps each control in its label, so the label's text also
    carries the control's own text (a select's options, a textarea's server
    rendered value). Matching the whole label text breaks on any value.
    """
    return (
        scope.locator("label")
        .filter(has_text=re.compile(rf"^\s*{re.escape(label)}"))
        .locator("input, textarea, select")
        .first
    )


def fill_activity_form(page: Page, title: str, summary: str) -> None:
    """Write a complete v3 task book by hand through the teacher form.

    The form opens with the structural minimums already in place (two goals,
    three phases, four rubric dimensions, physics with chinese), so only the
    prose and the links between goals, phases and dimensions are filled here.
    Whole-project submission keeps the loop on one revision chain.
    """
    form = page.locator('#activity-draft-v3-form[data-hydrated="true"]')
    form.wait_for(state="visible")
    form_field(form, "任务标题").fill(title)
    form_field(form, "任务主题").fill("校园证据核验")
    form_field(form, "任务描述").fill(summary)
    form_field(form, "提交模式").select_option("once")
    form_field(form, "背景设定").fill(
        "你们是学校后勤处请来的校园记录核验员，要把核验结论交给后勤处，"
        "回答：这份观察记录能不能作为改进依据？"
    )

    contributions = form.locator("li").filter(has_text="学科贡献")
    if contributions.count() < 2:
        raise E2eFailure("V3_FORM_CONTRIBUTIONS_MISSING")
    for index in range(contributions.count()):
        card = contributions.nth(index)
        form_field(card, "学科贡献").fill("提供本学科独有的观察与表达方法。")
        form_field(card, "不可替代性").fill("缺少这门学科，结论就无法被核验或说清。")

    goal_descriptions = (
        "能识别可核验的观察证据。",
        "能用证据写出可复验的结论。",
    )
    goals = form.locator("li").filter(has_text="可观察目标")
    if goals.count() != len(goal_descriptions):
        raise E2eFailure("V3_FORM_GOAL_COUNT_CHANGED")
    for index, description in enumerate(goal_descriptions):
        goal = goals.nth(index)
        form_field(goal, "可观察目标").fill(description)
        goal.locator('input[type="checkbox"]').first.check()

    form_field(form, "总体任务说明").fill(
        "完成一次校园观察，记录数据，并用文字说明证据如何支持结论。"
    )
    phase_actions = (
        "提出一个可以通过观察验证的问题。",
        "收集并比较至少两项观察记录。",
        "用证据表达结论并回应同伴质疑。",
    )
    phases = form.locator("li").filter(has_text="核心动作")
    if phases.count() != len(phase_actions):
        raise E2eFailure("V3_FORM_PHASE_COUNT_CHANGED")
    for index, action in enumerate(phase_actions):
        phase = phases.nth(index)
        form_field(phase, "核心动作").fill(action)
        form_field(phase, "情境承接").fill(
            f"承接校园证据核验任务的第 {index + 1} 步。"
        )
        form_field(phase, "学习支架").fill(
            "1. 列出问题\n2. 填写记录表\n可以这样写：「我们发现……」"
        )
        form_field(phase, "评价要点").fill("记录可核验，结论与证据一致。")
        form_field(phase, "任务要求").fill(
            f"第 {index + 1} 阶段的文字记录与依据。"
        )
        for checkbox in phase.locator('input[type="checkbox"]').all():
            checkbox.check()

    rubric = form.locator("li").filter(has_text="评价维度")
    if rubric.count() < 4:
        raise E2eFailure("V3_FORM_RUBRIC_MISSING")
    for index in range(rubric.count()):
        dimension = rubric.nth(index)
        form_field(dimension, "优秀").fill("证据完整且解释清晰。")
        form_field(dimension, "良好").fill("主要证据完整，解释基本清晰。")
        form_field(dimension, "达标").fill("有基本证据和可理解的解释。")
        form_field(dimension, "需改进").fill("证据或解释仍需补充。")
        for checkbox in dimension.locator('input[type="checkbox"]').all():
            checkbox.check()


def expand_submission_history(page: Page) -> None:
    """Open every collapsed section.

    After a resubmission the student page keeps only the newest revision
    expanded, so older feedback is present but not readable until a reader
    opens it. Historical readability is what these assertions are about.
    """
    for _ in range(12):
        closed = page.locator("details:not([open]) > summary")
        if closed.count() == 0:
            return
        closed.first.click()


def wait_for_autosave(page: Page) -> None:
    """The student draft saves itself once typing pauses (no save button).

    Wait for the edit to register as unsaved first; otherwise the check could
    pass on the status left over from the previous save.
    """
    page.locator('[data-dirty="true"]').wait_for(timeout=10_000)
    page.locator('[data-dirty="false"]').filter(has_text="已自动保存").wait_for(
        timeout=30_000
    )


def submit_to_teacher(page: Page, revision_number: int) -> None:
    page.get_by_role("button", name="提交给老师", exact=True).click()
    confirm_dialog(page, "提交给老师？", "确认提交")
    wait_for_text(page, f"第 {revision_number} 版已提交给老师")


FEEDBACK_REVISE_BUTTON = "保存 · 请学生修改"
# The roster's per-row action is named for what the row needs (评阅 or 查看);
# its destination is the contract.
SUBMISSION_ROW_LINK = 'a[href^="/teacher/submissions/"]'


def choose(page: Page, name: str, value: str) -> None:
    """Pick one of the review page's segmented choices (native radios)."""
    page.locator("label", has=page.locator(f'input[name="{name}"][value="{value}"]')).click()


def fill_feedback_when_ready(
    page: Page,
    body: str,
    support_level: str = "FOUNDATION",
) -> None:
    """Fill after hydration and prove React enabled the save actions.

    The support level is frozen with the body; the next step is chosen by
    which save button is pressed (D-079), so both stay disabled until the
    body and support level are set.
    """
    textarea = page.locator("#teacher-feedback-body")
    support_radio = page.locator(
        f'input[name="supportLevel"][value="{support_level}"]'
    )
    button = page.get_by_role("button", name=FEEDBACK_REVISE_BUTTON, exact=True)
    textarea.wait_for(state="visible")
    button.wait_for(state="visible")

    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        textarea.fill(body)
        choose(page, "supportLevel", support_level)
        if (
            textarea.input_value() == body
            and support_radio.is_checked()
            and button.is_enabled()
        ):
            return
        page.wait_for_timeout(250)

    raise E2eFailure("FEEDBACK_COMPOSER_NOT_HYDRATED")


def click_and_wait_for_url(
    page: Page,
    button_name: str,
    url_pattern: re.Pattern[str],
) -> None:
    button = page.get_by_role("button", name=button_name, exact=True)
    for attempt in range(1, 4):
        button.click()
        try:
            page.wait_for_url(url_pattern, timeout=10_000)
            return
        except PlaywrightTimeoutError:
            if attempt == 3:
                raise E2eFailure("FORM_SUBMISSION_NAVIGATION_TIMEOUT")
            page.wait_for_timeout(250)


def run_browser_flow(
    base_url: str,
    marker: str,
    artifacts: Path,
    environment: dict[str, str],
    credentials: dict[str, dict[str, str]],
) -> None:
    title = f"E2E 闭环 {marker}"
    first_evidence = f"{marker} 第一版证据：观察记录与解释。"
    second_evidence = f"{marker} 第二版证据：补充数据与反思。"
    third_evidence = f"{marker} 第三版工作草稿：成员结束后只能读取。"
    first_feedback = f"{marker} 第一版反馈：证据清楚，请补充数据来源。"
    second_feedback = f"{marker} 第二版反馈：补充完整，已形成可核验结论。"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            locale="zh-CN",
            timezone_id="Asia/Taipei",
            viewport={"width": 1440, "height": 1000},
        )
        page = context.new_page()
        page.set_default_timeout(30_000)

        try:
            switch_account(page, base_url, "teacher", credentials)
            foreign_response = page.goto(
                f"{base_url}/teacher/activities/{FOREIGN_DRAFT_ID}",
                wait_until="domcontentloaded",
            )
            if not foreign_response or foreign_response.status != 404:
                raise E2eFailure("FOREIGN_TEACHER_DRAFT_NOT_HIDDEN")

            page.goto(f"{base_url}/teacher", wait_until="domcontentloaded")
            # Drafting lives in the activity studio, not on the workspace home.
            # Follow the sidebar entry by its destination: the label is free to
            # move, the route is the contract.
            page.locator('#workspace-navigation a[href="/teacher/activities"]').click()
            page.wait_for_url(f"{base_url}/teacher/activities")
            page.get_by_role("link", name="新建学习活动", exact=True).click()
            page.wait_for_url(f"{base_url}/teacher/activities/new")

            fill_activity_form(
                page,
                title,
                "第一版摘要：建立可复验的学习证据。",
            )
            page.get_by_role("button", name="保存为编辑中", exact=True).click()
            page.wait_for_url(re.compile(rf"{re.escape(base_url)}/teacher/activities/[0-9a-f-]+$"))
            draft_form = page.locator('#activity-draft-v3-form[data-hydrated="true"]')
            draft_form.wait_for(state="visible")
            if page.locator('input[name="expectedVersion"]').input_value() != "1":
                raise E2eFailure("DRAFT_VERSION_ONE_NOT_RENDERED")

            form_field(draft_form, "任务描述").fill(
                "第二版摘要：建立可复验的学习证据，并明确数据来源。"
            )
            page.get_by_role("button", name="保存并标记可预览", exact=True).click()
            preview_link = page.get_by_role("link", name=re.compile("查看发布预览"))
            preview_link.wait_for(state="visible")
            if page.locator('input[name="expectedVersion"]').input_value() != "2":
                raise E2eFailure("DRAFT_VERSION_TWO_NOT_RENDERED")
            screenshot(page, artifacts, "01-draft-versioned")

            preview_link.click()
            page.get_by_role(
                "button", name="准备发布确认", exact=True
            ).click()
            confirm_dialog(page, "确认发布活动", "确认并发布")
            wait_for_text(page, "活动已发布")
            release_link = page.get_by_role(
                "link", name="查看发布与学生提交", exact=True
            )
            release_href = release_link.get_attribute("href")
            if not release_href:
                raise E2eFailure("RELEASE_LINK_MISSING")
            screenshot(page, artifacts, "02-published")

            switch_account(page, base_url, "student", credentials)
            student_release_link = page.get_by_role(
                "link", name=f"打开活动：{title}", exact=True
            )
            student_release_href = student_release_link.get_attribute("href")
            if not student_release_href:
                raise E2eFailure("STUDENT_RELEASE_LINK_MISSING")
            student_release_link.click()
            page.locator("#text-evidence").fill(first_evidence)
            wait_for_autosave(page)
            submit_to_teacher(page, 1)
            screenshot(page, artifacts, "03-student-submitted-v1")

            denied_response = page.goto(
                f"{base_url}{release_href}", wait_until="domcontentloaded"
            )
            if not denied_response or denied_response.status != 404:
                raise E2eFailure("STUDENT_TEACHER_ROUTE_NOT_HIDDEN")
            if page.get_by_role("button", name="准备关闭活动", exact=True).count() != 0:
                raise E2eFailure("STUDENT_ACCESSED_TEACHER_RELEASE_CONTROL")

            switch_account(page, base_url, "teacher", credentials)
            page.goto(f"{base_url}{release_href}", wait_until="domcontentloaded")
            submission_link = page.locator(SUBMISSION_ROW_LINK).first
            submission_href = submission_link.get_attribute("href")
            if not submission_href:
                raise E2eFailure("SUBMISSION_LINK_MISSING")
            submission_link.click()
            fill_feedback_when_ready(page, first_feedback)
            page.get_by_role("button", name=FEEDBACK_REVISE_BUTTON, exact=True).click()
            confirm_dialog(page, "确认并保存最终反馈", "确认并保存最终反馈")
            open_confirmed_records(page)
            page.get_by_text(first_feedback, exact=True).last.wait_for(state="visible")

            switch_account(page, base_url, "student", credentials)
            page.goto(f"{base_url}{student_release_href}", wait_until="domcontentloaded")
            wait_for_text(page, first_feedback)
            page.get_by_role("button", name="按老师的反馈修改", exact=True).click()
            page.locator("#text-evidence").wait_for(state="visible")
            page.locator("#text-evidence").fill(second_evidence)
            wait_for_autosave(page)
            submit_to_teacher(page, 2)
            screenshot(page, artifacts, "04-student-resubmitted-v2")

            switch_account(page, base_url, "teacher", credentials)
            page.goto(f"{base_url}{submission_href}", wait_until="domcontentloaded")
            fill_feedback_when_ready(page, second_feedback)
            page.get_by_role("button", name=FEEDBACK_REVISE_BUTTON, exact=True).click()
            confirm_dialog(page, "确认并保存最终反馈", "确认并保存最终反馈")
            open_confirmed_records(page)
            page.get_by_text(second_feedback, exact=True).last.wait_for(state="visible")

            switch_account(page, base_url, "student", credentials)
            page.goto(
                f"{base_url}{student_release_href}",
                wait_until="domcontentloaded",
            )
            page.get_by_role("button", name="按老师的反馈修改", exact=True).click()
            page.locator("#text-evidence").fill(third_evidence)
            wait_for_autosave(page)

            membership_result = run_command(
                [
                    "pnpm",
                    "exec",
                    "tsx",
                    "scripts/e2e/end-current-membership.ts",
                ],
                environment=environment,
                capture_output=True,
            )
            if not json.loads(membership_result.stdout).get(
                "historicalMembership"
            ):
                raise E2eFailure("HISTORICAL_MEMBERSHIP_FIXTURE_FAILED")

            page.goto(
                f"{base_url}{student_release_href}",
                wait_until="domcontentloaded",
            )
            wait_for_text(page, "历史成员 · 只读")
            wait_for_text(
                page,
                "你已不是该班级的当前成员",
            )
            historical_textarea = page.locator("#text-evidence")
            historical_textarea.wait_for(state="visible")
            if (
                historical_textarea.input_value() != third_evidence
                or historical_textarea.is_editable()
            ):
                raise E2eFailure("HISTORICAL_MEMBER_WORKING_COPY_NOT_READONLY")
            for action_label in (
                "保存",
                "提交给老师",
                "迟交给老师",
                "按老师的反馈修改",
                "再交一版改进",
            ):
                if page.get_by_role(
                    "button", name=action_label, exact=True
                ).count() != 0:
                    raise E2eFailure("HISTORICAL_MEMBER_WRITE_ACTION_VISIBLE")
            expand_submission_history(page)
            wait_for_text(page, first_feedback)
            wait_for_text(page, second_feedback)
            screenshot(page, artifacts, "05-historical-member-readonly")

            switch_account(page, base_url, "teacher", credentials)
            page.goto(f"{base_url}{release_href}", wait_until="domcontentloaded")
            # Closing is a rare, one-way action, so the roster keeps it folded
            # away under the activity settings.
            page.locator("summary").filter(has_text="活动设置").click()
            page.get_by_role("button", name="准备关闭活动", exact=True).click()
            confirm_dialog(page, "确认关闭这个活动", "确认并关闭活动")
            page.get_by_role(
                "button", name="准备关闭活动", exact=True
            ).wait_for(state="detached")
            screenshot(page, artifacts, "06-closed-by-teacher")

            switch_account(page, base_url, "student", credentials)
            page.goto(f"{base_url}{student_release_href}", wait_until="domcontentloaded")
            wait_for_text(page, "已关闭 · 只读")
            wait_for_text(page, "活动已结束，内容仍可查看")
            closed_textarea = page.locator("#text-evidence")
            closed_textarea.wait_for(state="visible")
            if (
                closed_textarea.input_value() != third_evidence
                or closed_textarea.is_editable()
            ):
                raise E2eFailure("CLOSED_RELEASE_WORKING_COPY_NOT_READONLY")
            for action_label in (
                "保存",
                "提交给老师",
                "迟交给老师",
                "按老师的反馈修改",
                "再交一版改进",
            ):
                if page.get_by_role("button", name=action_label, exact=True).count() != 0:
                    raise E2eFailure("CLOSED_RELEASE_WRITE_ACTION_VISIBLE")
            expand_submission_history(page)
            wait_for_text(page, first_feedback)
            wait_for_text(page, second_feedback)
            screenshot(page, artifacts, "07-closed-student-history-readonly")

            switch_account(page, base_url, "teacher", credentials)
            page.goto(
                f"{base_url}/teacher/activities/new",
                wait_until="domcontentloaded",
            )
            concurrency_title = f"E2E 并发 {marker}"
            fill_activity_form(
                page,
                concurrency_title,
                "准备确认后，将由另一个页面追加新版本。",
            )
            click_and_wait_for_url(
                page,
                "保存并标记可预览",
                re.compile(
                    rf"{re.escape(base_url)}/teacher/activities/[0-9a-f-]+$"
                ),
            )
            concurrency_draft_path = urlparse(page.url).path
            page.get_by_role("link", name=re.compile("查看发布预览")).click()
            page.get_by_role(
                "button", name="准备发布确认", exact=True
            ).click()
            dialog_titled(page, "确认发布活动").wait_for(state="visible")

            competing_page = context.new_page()
            try:
                competing_page.goto(
                    f"{base_url}{concurrency_draft_path}",
                    wait_until="domcontentloaded",
                )
                form_field(
                    competing_page.locator(
                        '#activity-draft-v3-form[data-hydrated="true"]'
                    ),
                    "任务描述",
                ).fill(
                    "并发页面已经追加第二版，旧确认不得发布第一版。"
                )
                competing_page.get_by_role(
                    "button", name="保存并标记可预览", exact=True
                ).click()
                competing_page.wait_for_function(
                    """() =>
                      document.querySelector('input[name="expectedVersion"]')?.value === '2'
                    """,
                    timeout=30_000,
                )
            finally:
                competing_page.close()

            page.bring_to_front()
            confirm_dialog(page, "确认发布活动", "确认并发布")
            wait_for_text(
                page,
                "草稿、班级或确认状态已经变化，未创建新的发布",
            )
            if page.get_by_role(
                "link", name="查看发布与学生提交", exact=True
            ).count() != 0:
                raise E2eFailure("STALE_CONFIRMATION_CREATED_RELEASE")
            screenshot(page, artifacts, "08-stale-publish-rejected")
        except Exception:
            screenshot(page, artifacts, "failure")
            raise
        finally:
            context.close()
            browser.close()


def run_real_model_browser_flow(
    base_url: str,
    marker: str,
    artifacts: Path,
    credentials: dict[str, dict[str, str]],
) -> None:
    title = f"E2E AI 草稿 {marker}"
    attachment_fixture = (
        REPOSITORY_ROOT / "scripts" / "probe" / "fixtures" / "student-work.png"
    )
    prompt = f"""資料已完整。請先調用 search_knowledge 檢索官方課程方案及物理、數學、語文課程標準，再用 read_source_section 核對相關原文；之後提出 D-033 結構化任務理解與設計建議，至少引用兩個不同官方來源，等待教師確認後才建立草稿；不要發佈，也不要提問。
標題必須逐字為：{title}
請建立完整跨學科任務書：初中七年級，主學科物理，融合數學與語文；探究性作業、調查探究、中等探究、一次性提交、2周。
探究主題與摘要聚焦校園節水觀察；背景是學生受邀核驗兩次不含個資的合成水表讀數。
設置3條可觀察學習目標：辨識可核驗的用水證據、根據數據形成改善建議、願意為公共資源負責，每條掛適配七年級的官方核心素養。
總體任務要求學生比較讀數差異，并用文字解釋證據如何支持建議。
設置3個連續階段，每階段都有明確行動、情境承接、學習支架、至少一項類型化提交證據、評價要點和課時建議。
設置問題意識、證據質量、跨學科連接、方案表達4個量規維度，每個維度都有優秀、良好、達標、需改進四檔非空描述，並寫明評價哪幾條目標。
內容只使用以上合成資料。提案必須明確列出教師已提供要求、假設、物理、數學與語文各自的貢獻與不可替代性，並讓每條目標都被某個階段承擔、被某個量規維度評價；然後調用 create_activity_draft 等待確認。"""

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            locale="zh-CN",
            timezone_id="Asia/Taipei",
            viewport={"width": 1440, "height": 1000},
        )
        page = context.new_page()
        page.set_default_timeout(30_000)

        try:
            switch_account(page, base_url, "teacher", credentials)

            # D-047 is verified against a draft the teacher wrote by hand, so
            # the read-back evidence does not depend on the model's ability to
            # author a whole task book in the later proposal step.
            read_title = f"E2E AI 讀取 {marker}"
            page.goto(
                f"{base_url}/teacher/activities/new",
                wait_until="domcontentloaded",
            )
            fill_activity_form(
                page,
                read_title,
                "供助手只读回看的手工草稿。",
            )
            page.get_by_role("button", name="保存为编辑中", exact=True).click()
            page.wait_for_url(
                re.compile(
                    rf"{re.escape(base_url)}/teacher/activities/[0-9a-f-]+$"
                )
            )
            draft_url = page.url
            page.get_by_role(
                "button", name="打开 CDAS Agent 独立会话", exact=True
            ).click()
            assistant_prompt = page.locator(
                '#activity-assistant-prompt[data-hydrated="true"]'
            )
            assistant_prompt.wait_for()
            assistant_prompt.fill(
                "请先确认我当前所在的页面，再读取这份草稿的完整任务书，"
                "然后只用一句话说明第二个阶段在情境承接上还差什么。"
                "只读取，不要建立新草稿，也不要发布。"
            )
            page.get_by_role("button", name="交给助手整理", exact=True).click()
            assert_stop_control_exists(page)
            page.get_by_text(f"读取草稿 · {read_title}", exact=True).wait_for(
                timeout=120_000
            )
            if page.get_by_role("link", name="打开草稿", exact=True).count() == 0:
                raise E2eFailure("REAL_MODEL_DRAFT_READ_LINK_MISSING")
            if page.url != draft_url:
                raise E2eFailure("REAL_MODEL_DRAFT_READ_NAVIGATED")
            # Let the read turn settle before reloading. Navigating mid-stream
            # would abort it and leave a CANCELLED AgentRun that says nothing
            # about the read itself.
            settle_assistant_stream(page)
            # The transcript scrolls inside the panel, so bring the result the
            # assertions just proved into frame before capturing evidence.
            page.get_by_text(f"读取草稿 · {read_title}", exact=True).scroll_into_view_if_needed()
            screenshot(page, artifacts, "00-real-model-draft-read")

            # D-048: the teacher asks for the change to be applied. The
            # revision must pause for confirmation, and version 1 must survive
            # as history once it is confirmed.
            page.locator(
                '#activity-assistant-prompt[data-hydrated="true"]'
            ).fill(
                "就按你说的改：只改第二个阶段的情境承接，让它接住第一个阶段的产出，"
                "其他部分一个字都不要动。改完写回这份草稿。"
            )
            page.get_by_role("button", name="交给助手整理", exact=True).click()
            revision = page.locator('[role="group"][aria-label="草稿改写确认"]')
            revision.get_by_role(
                "button", name="确认并改写草稿", exact=True
            ).wait_for(timeout=120_000)
            revision.get_by_text("任务链阶段", exact=True).wait_for()
            revision.scroll_into_view_if_needed()
            screenshot(page, artifacts, "01-real-model-draft-revision")
            revision.get_by_role(
                "button", name="确认并改写草稿", exact=True
            ).click()
            page.get_by_text("草稿已改写 · 版本 1 → 2", exact=True).wait_for(
                timeout=120_000
            )
            if page.url != draft_url:
                raise E2eFailure("REAL_MODEL_DRAFT_REVISION_NAVIGATED")
            settle_assistant_stream(page)
            page.get_by_text("草稿已改写 · 版本 1 → 2", exact=True).scroll_into_view_if_needed()
            screenshot(page, artifacts, "02-real-model-draft-revised")

            # A full reload clears the in-memory session, so the proposal step
            # below starts from an empty conversation exactly as before.
            page.goto(
                f"{base_url}/teacher/activities/new",
                wait_until="domcontentloaded",
            )
            page.get_by_role(
                "button", name="打开 CDAS Agent 独立会话", exact=True
            ).click()
            textarea = page.locator(
                '#activity-assistant-prompt[data-hydrated="true"]'
            )
            textarea.wait_for()
            submit = page.get_by_role("button", name="交给助手整理", exact=True)
            textarea.fill(prompt)
            if not submit.is_enabled():
                raise E2eFailure("REAL_MODEL_ASSISTANT_NOT_HYDRATED")
            submit.click()
            proposal = page.locator('[role="group"][aria-label="任务理解确认"]')
            proposal.get_by_role(
                "button", name="确认理解并创建草稿", exact=True
            ).wait_for(timeout=120_000)
            for label in (
                "教师已提供要求",
                "明确假设",
                "跨学科必要性",
                "目标—任务—证据—评价一致性链",
                "本次设计参考了哪些依据",
            ):
                proposal.get_by_text(label, exact=True).wait_for()
            if proposal.locator(
                'section[aria-label="本次设计参考了哪些依据"] a[href^="/teacher/knowledge?source="]'
            ).count() < 2:
                raise E2eFailure("REAL_MODEL_OFFICIAL_REFERENCES_MISSING")
            if page.locator(
                "details > summary", has_text="已读取："
            ).count() < 2:
                raise E2eFailure("REAL_MODEL_SOURCE_READING_MISSING")
            # v3 names each discipline by its label and each goal by position.
            contributions = proposal.locator('section[aria-label="跨学科必要性"]')
            contributions.get_by_text("数学", exact=True).wait_for()
            contributions.get_by_text("语文", exact=True).wait_for()
            proposal.get_by_text("目标 1", exact=True).wait_for()
            screenshot(page, artifacts, "03-real-model-draft-proposal")
            # The idle badge this used to wait for no longer exists; the panel
            # now only marks the busy state. Wait for that to clear instead.
            settle_assistant_stream(page)
            proposal.get_by_role(
                "button", name="确认理解并创建草稿", exact=True
            ).click()
            preview_link = page.get_by_role(
                "link", name="查看预览", exact=True
            )
            preview_link.wait_for(timeout=120_000)
            preview_link.click()
            page.wait_for_url(
                re.compile(
                    rf"{re.escape(base_url)}/teacher/activities/[0-9a-f-]+/preview$"
                ),
                timeout=120_000,
            )
            wait_for_text(page, title)
            wait_for_text(page, "版本 1")
            for heading in (
                "基本设置",
                "背景设定",
                "总体任务",
                "学习目标与课程依据",
                "学科分工",
                "阶段任务",
                "评价标准",
            ):
                page.get_by_role("heading", name=heading, level=3, exact=True).wait_for()
            if page.get_by_role(
                "link", name="查看发布与学生提交", exact=True
            ).count() != 0:
                raise E2eFailure("REAL_MODEL_SMOKE_CREATED_RELEASE")
            screenshot(page, artifacts, "04-real-model-draft-preview")

            # The assertion above proves the model did not publish anything by
            # itself. From here the teacher publishes through the ordinary
            # first-party UI, and the drafting steps run against the
            # hand-written draft so their evidence does not depend on what the
            # model chose to author.
            page.goto(f"{draft_url}/preview", wait_until="domcontentloaded")
            page.get_by_role(
                "button", name="准备发布确认", exact=True
            ).click()
            confirm_dialog(page, "确认发布活动", "确认并发布")
            wait_for_text(page, "活动已发布")
            release_link = page.get_by_role(
                "link", name="查看发布与学生提交", exact=True
            )
            release_href = release_link.get_attribute("href")
            if not release_href:
                raise E2eFailure("REAL_MODEL_RELEASE_LINK_MISSING")

            switch_account(page, base_url, "student", credentials)
            # Read the name the roster must never show, from the page itself.
            # The top bar's account menu names the signed-in user in its
            # accessible label; the menu text itself only renders when opened.
            student_display_name = ""
            account_label = page.locator('[aria-label^="当前账号："]').first
            if account_label.count() != 0:
                match = re.search(
                    r"当前账号：\s*([^·\n]+)",
                    account_label.get_attribute("aria-label") or "",
                )
                if match:
                    student_display_name = match.group(1).strip()
            page.get_by_role(
                "link", name=f"打开活动：{read_title}", exact=True
            ).click()
            page.locator("#text-evidence").fill(
                f"{marker} 我在教学楼三楼记录了两次水表读数，第二次比第一次多，"
                "具体差值、柱状图和漏水备注都在附件里，请结合附件判断。"
            )
            wait_for_autosave(page)
            page.locator('input[type="file"]').set_input_files(
                str(attachment_fixture)
            )
            wait_for_text(page, "文件已上传。")
            # Assert the attachment row itself reached READY, by structure, not
            # by the status word — a copy change would move it again.
            page.locator(
                '[data-attachment-editor] li[data-status="READY"]'
            ).filter(has_text=attachment_fixture.name).wait_for()
            submit_to_teacher(page, 1)

            switch_account(page, base_url, "teacher", credentials)
            page.goto(f"{base_url}{release_href}", wait_until="domcontentloaded")
            page.locator(SUBMISSION_ROW_LINK).first.click()

            # D-052: the feedback drafter must fill the real form, and the
            # teacher's ordinary confirmation must save it as AI_ASSISTED.
            page.get_by_role(
                "button", name="让助手起草这一版反馈", exact=True
            ).click()
            page.get_by_text(
                "AI 建议已填入当前表单。请核对、修改后，再准备反馈确认。",
                exact=True,
            ).wait_for(timeout=120_000)
            drafted_feedback = page.locator("#teacher-feedback-body").input_value()
            if len(drafted_feedback) < 40:
                raise E2eFailure("REAL_MODEL_FEEDBACK_DRAFT_TOO_SHORT")
            # The suggested next step is announced next to the save buttons.
            if page.get_by_text(re.compile(r"^AI 建议：")).count() == 0:
                raise E2eFailure("REAL_MODEL_FEEDBACK_DRAFT_NEXT_STEP_MISSING")
            if page.locator('input[name="supportLevel"]:checked').count() != 1:
                raise E2eFailure("REAL_MODEL_FEEDBACK_DRAFT_SUPPORT_LEVEL_MISSING")
            if not any(
                fact in drafted_feedback
                for fact in ("6.7", "25.6", "11.3", "食堂", "滴水")
            ):
                raise E2eFailure("REAL_MODEL_FEEDBACK_IGNORED_ATTACHMENT")
            # The verifier proves this text never reached the audit trail.
            (artifacts / "drafted-feedback.txt").write_text(
                drafted_feedback, encoding="utf-8"
            )
            screenshot(page, artifacts, "05-real-model-feedback-draft")
            page.get_by_role("button", name=FEEDBACK_REVISE_BUTTON, exact=True).click()
            confirm_dialog(page, "确认并保存最终反馈", "确认并保存最终反馈")
            # Confirmed records live in a native <details> that CLASSICAL.md
            # requires to start collapsed, so the provenance line is in the DOM
            # but not visible. Open it the way a teacher would, then assert.
            page.locator("summary").filter(has_text="已保存的记录").click()
            page.get_by_text("AI 建议 · 教师已确认").first.wait_for(
                timeout=120_000
            )

            # D-044: the evaluation drafter, through the same confirmation chain.
            page.get_by_role(
                "button", name="让助手起草这一版评价", exact=True
            ).click()
            page.get_by_text(
                "AI 建议已填入当前表单。请逐维核对、修改后，再保存评价。",
                exact=True,
            ).wait_for(timeout=120_000)
            attachment_citations = page.get_by_role(
                "checkbox",
                name=f"附件 {attachment_fixture.name}",
                exact=True,
            )
            if attachment_citations.count() == 0 or not attachment_citations.evaluate_all(
                "elements => elements.some((element) => element.checked)"
            ):
                raise E2eFailure("REAL_MODEL_EVALUATION_ATTACHMENT_CITATION_MISSING")
            screenshot(page, artifacts, "06-real-model-evaluation-draft")
            prepare_evaluation = page.get_by_role(
                "button", name="保存评价", exact=True
            )
            if not prepare_evaluation.is_enabled():
                raise E2eFailure("REAL_MODEL_EVALUATION_DRAFT_INCOMPLETE")
            prepare_evaluation.click()
            confirm_dialog(page, "确认并保存量规评价", "确认并保存量规评价")
            page.wait_for_timeout(500)
            if page.get_by_text("AI 建议 · 教师已确认").count() < 2:
                raise E2eFailure("REAL_MODEL_EVALUATION_NOT_AI_ASSISTED")
            screenshot(page, artifacts, "07-real-model-review-saved")

            # D-051: the assistant reports this release's process diagnostics,
            # and they are the diagnostics page's own numbers.
            page.goto(f"{base_url}/teacher", wait_until="domcontentloaded")
            page.get_by_role(
                "button", name="打开 CDAS Agent 独立会话", exact=True
            ).click()
            assistant_prompt = page.locator(
                '#activity-assistant-prompt[data-hydrated="true"]'
            )
            assistant_prompt.wait_for()
            assistant_prompt.fill(
                f"先列出我的发布，再读《{read_title}》这次发布的过程诊断，"
                "告诉我学生卡在哪个阶段、量规哪一维最弱。不要建立或改写任何草稿。"
            )
            page.get_by_role("button", name="交给助手整理", exact=True).click()
            insights = page.get_by_text(
                f"过程诊断 · {read_title}", exact=True
            )
            insights.wait_for(timeout=120_000)
            insights_block = page.locator(
                "div", has=insights
            ).last
            insights_text = insights_block.inner_text()
            for expected in ("对象 1", "已评价 1 份"):
                if expected not in insights_text:
                    raise E2eFailure("REAL_MODEL_INSIGHTS_COUNT_MISMATCH")
            settle_assistant_stream(page)
            insights.scroll_into_view_if_needed()
            screenshot(page, artifacts, "08-real-model-process-insights")

            # D-054: the roster names no one. The submitting student appears
            # as an ordinal, and their display name must not be in the panel.
            page.locator(
                '#activity-assistant-prompt[data-hydrated="true"]'
            ).fill(
                f"再看《{read_title}》这次发布的提交名册，告诉我哪几个需要我先看。"
                "不要建立或改写任何草稿。"
            )
            page.get_by_role("button", name="交给助手整理", exact=True).click()
            roster = page.get_by_text(
                re.compile(rf"提交名册 · {re.escape(read_title)} · \d+/\d+")
            )
            roster.wait_for(timeout=120_000)
            roster_block = page.locator("div", has=roster).last
            roster_text = roster_block.inner_text()
            if "对象 1" not in roster_text:
                raise E2eFailure("REAL_MODEL_ROSTER_ORDINAL_MISSING")
            if "待反馈" in roster_text and "待评价" not in roster_text:
                raise E2eFailure("REAL_MODEL_ROSTER_REVIEW_STATE_MISSING")
            # Fail closed: a guard that silently had no name to look for would
            # pass no matter what the roster contained.
            if len(student_display_name) < 2:
                raise E2eFailure("REAL_MODEL_ROSTER_STUDENT_NAME_UNKNOWN")
            if student_display_name in roster_text:
                raise E2eFailure("REAL_MODEL_ROSTER_LEAKED_STUDENT_NAME")
            if page.get_by_role("link", name=re.compile("阶段|整项提交")).count() == 0:
                raise E2eFailure("REAL_MODEL_ROSTER_REVIEW_LINK_MISSING")
            settle_assistant_stream(page)
            roster.scroll_into_view_if_needed()
            screenshot(page, artifacts, "09-real-model-release-roster")

            # Links belong to the result cards. A reply that spells one out
            # had to invent a host for it, and the teacher cannot open that.
            replies = page.locator('article[data-role="assistant"]').all_inner_texts()
            if any("://" in reply for reply in replies):
                raise E2eFailure("REAL_MODEL_REPLY_INVENTED_URL")

            # The same numbers must be what the first-party page shows.
            page.goto(f"{base_url}/teacher/insights", wait_until="domcontentloaded")
            wait_for_text(page, read_title)
        except Exception:
            screenshot(page, artifacts, "failure")
            # The transcript is what the model actually did. Without it a
            # timeout only says "no approval appeared", which is the same
            # evidence for a refusal, a clarifying question and a truncated
            # tool call. Synthetic data only; no credentials are rendered here.
            try:
                transcript = page.locator("article[data-role]").all_inner_texts()
            except PlaywrightError:
                transcript = []
            (artifacts / "transcript.txt").write_text(
                redact_sensitive_text("\n\n---\n\n".join(transcript)),
                encoding="utf-8",
            )
            raise
        finally:
            context.close()
            browser.close()


def main() -> int:
    real_model_smoke = use_real_model_smoke()
    marker = run_marker(real_model_smoke=real_model_smoke)
    credentials = {
        "teacher": {
            "schoolCode": "SCHARCHX",
            "account": os.environ.get("E2E_TEACHER_STAFF_NO", "E2E-T1"),
            "password": secrets.token_urlsafe(18) + "A1",
        },
        "student": {
            "schoolCode": "SCHARCHX",
            "account": os.environ.get("E2E_STUDENT_NO", "100001"),
            "password": secrets.token_urlsafe(18) + "A1",
        },
    }
    artifacts = REPOSITORY_ROOT / "output" / "e2e" / marker
    artifacts.mkdir(parents=True, exist_ok=False)
    environment = dict(os.environ)
    e2e_database_url, e2e_port = local_e2e_database_url(environment)
    base_url = environment.get("E2E_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    if base_url != DEFAULT_BASE_URL:
        raise E2eFailure("E2E_BASE_URL_MUST_BE_LOOPBACK_GATE_PORT")

    environment.update(
        {
            "E2E_DATABASE_URL": e2e_database_url,
            "E2E_RUN_MARKER": marker,
            "CDAS_E2E_POSTGRES_PORT": str(e2e_port),
        }
    )
    bootstrap_environment = dict(environment)
    bootstrap_environment.update(
        {
            "AI_PROVIDER_DISABLED": "0" if real_model_smoke else "1",
            "E2E_TEACHER_STAFF_NO": credentials["teacher"]["account"],
            "E2E_STUDENT_NO": credentials["student"]["account"],
            "E2E_TEACHER_PASSWORD": credentials["teacher"]["password"],
            "E2E_STUDENT_PASSWORD": credentials["student"]["password"],
        }
    )
    runtime_environment = dict(environment)
    runtime_environment.update(
        {
            "DATABASE_URL": e2e_database_url,
            "DIRECT_URL": e2e_database_url,
            "AI_PROVIDER_DISABLED": "0" if real_model_smoke else "1",
        }
    )
    if real_model_smoke:
        runtime_environment.update(
            {
                "ATTACHMENT_STORAGE_ENABLED": "1",
                "ATTACHMENT_STORAGE_DIR": str(artifacts / "attachments"),
            }
        )
    if not real_model_smoke:
        runtime_environment.update(
            {
                "DEEPSEEK_API_KEY": "",
                "AI_TOOL_APPROVAL_SECRET": "",
            }
        )

    server_process: subprocess.Popen[str] | None = None
    server_log_path = artifacts / "next-server.log"
    try:
        if real_model_smoke:
            run_command(
                [
                    "pnpm",
                    "exec",
                    "tsx",
                    "scripts/e2e/preflight-real-model.ts",
                ],
                environment=bootstrap_environment,
                capture_output=True,
            )
        run_command(
            ["docker", "compose", "rm", "--stop", "--force", "e2e-database"],
            environment=environment,
        )
        run_command(
            ["docker", "compose", "up", "--detach", "--wait", "e2e-database"],
            environment=environment,
        )
        run_command(
            ["pnpm", "exec", "prisma", "migrate", "deploy"],
            environment=runtime_environment,
        )
        run_command(
            ["pnpm", "exec", "tsx", "scripts/e2e/bootstrap.ts"],
            environment=bootstrap_environment,
        )
        bootstrap_environment.pop("E2E_TEACHER_PASSWORD", None)
        bootstrap_environment.pop("E2E_STUDENT_PASSWORD", None)

        with server_log_path.open("w", encoding="utf-8") as server_log:
            server_process = subprocess.Popen(
                [
                    "pnpm",
                    "exec",
                    "next",
                    "dev",
                    "--hostname",
                    "localhost",
                    "--port",
                    "3100",
                ],
                cwd=REPOSITORY_ROOT,
                env=runtime_environment,
                stdout=server_log,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
            wait_for_server(base_url, server_process)
            if real_model_smoke:
                run_real_model_browser_flow(
                    base_url,
                    marker,
                    artifacts,
                    credentials,
                )
            else:
                run_browser_flow(
                    base_url,
                    marker,
                    artifacts,
                    environment,
                    credentials,
                )

        verification_environment = dict(environment)
        existing_node_options = verification_environment.get("NODE_OPTIONS", "").strip()
        verification_environment["NODE_OPTIONS"] = " ".join(
            part
            for part in (existing_node_options, "--conditions=react-server")
            if part
        )
        verification = run_command(
            [
                "pnpm",
                "exec",
                "tsx",
                (
                    "scripts/e2e/verify-real-model-smoke.ts"
                    if real_model_smoke
                    else "scripts/e2e/verify-closed-loop.ts"
                ),
            ],
            environment=verification_environment,
            capture_output=True,
        )
        evidence = json.loads(verification.stdout)
        result = {
            "ok": True,
            "marker": marker,
            "browser": "chromium-headless",
            "authentication": "postgres-local-session",
            "database": "dedicated-local-postgresql",
            "aiProviderDisabled": not real_model_smoke,
            "gate": (
                "real-ai-gateway-draft-smoke"
                if real_model_smoke
                else "manual-closed-loop"
            ),
            "verification": evidence["evidence"],
        }
        (artifacts / "result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print(f"Evidence: {artifacts}")
        return 0
    except subprocess.CalledProcessError as error:
        detail = error.stderr or error.stdout or f"COMMAND_FAILED:{error.returncode}"
        safe_code = redact_sensitive_text(detail.strip())[:2_000]
        print(
            json.dumps({"ok": False, "error": {"code": safe_code}}, indent=2),
            file=sys.stderr,
        )
        print(f"Evidence: {artifacts}", file=sys.stderr)
        return 1
    except (
        E2eFailure,
        PlaywrightError,
        PlaywrightTimeoutError,
    ) as error:
        code = error.args[0] if error.args else type(error).__name__
        safe_code = redact_sensitive_text(str(code))[:2_000]
        print(
            json.dumps({"ok": False, "error": {"code": safe_code}}, indent=2),
            file=sys.stderr,
        )
        print(f"Evidence: {artifacts}", file=sys.stderr)
        return 1
    except Exception as error:
        print(
            json.dumps(
                {"ok": False, "error": {"code": type(error).__name__}},
                indent=2,
            ),
            file=sys.stderr,
        )
        print(f"Evidence: {artifacts}", file=sys.stderr)
        return 1
    finally:
        if server_process is not None:
            stop_server(server_process)
        sanitize_server_log(server_log_path)
        for identity in credentials.values():
            identity["password"] = ""


if __name__ == "__main__":
    raise SystemExit(main())
