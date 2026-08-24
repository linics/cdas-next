#!/usr/bin/env python3
"""Run the real-Clerk, isolated-PostgreSQL CDAS browser closed loop."""

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


def redact_sensitive_text(value: str) -> str:
    value = re.sub(
        r"(?i)(token=)[^&\s\"\\]+",
        r"\1[REDACTED]",
        value,
    )
    value = re.sub(
        r"\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+\b",
        "[REDACTED_CLERK_KEY]",
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


def confirm_dialog(page: Page, title: str, confirmation_label: str) -> None:
    dialog = page.get_by_role("dialog").filter(has_text=title)
    dialog.wait_for(state="visible", timeout=30_000)
    dialog.get_by_role("button", name=confirmation_label, exact=True).click()
    dialog.wait_for(state="hidden", timeout=30_000)


def request_clerk_ticket(page: Page, role: str, broker_secret: str) -> str:
    try:
        payload = page.evaluate(
            """async ({ role, secret }) => {
              const response = await fetch('/api/dev/e2e-clerk-ticket', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${secret}`,
                  'X-CDAS-E2E-Role': role,
                },
                cache: 'no-store',
                credentials: 'same-origin',
              });
              return {
                status: response.status,
                body: response.status === 200 ? await response.json() : null,
              };
            }""",
            {"role": role, "secret": broker_secret},
        )
        if payload.get("status") != 200:
            raise E2eFailure(f"CLERK_TICKET_BROKER_{payload.get('status')}")
        body = payload.get("body")
        if not isinstance(body, dict):
            raise E2eFailure("CLERK_TICKET_BROKER_INVALID_RESPONSE")
        ticket = body.get("ticket")
        expected_path = "/teacher" if role == "TEACHER" else "/student"
        if (
            body.get("ok") is not True
            or not isinstance(ticket, str)
            or not ticket
            or body.get("returnPath") != expected_path
        ):
            raise E2eFailure("CLERK_TICKET_BROKER_INVALID_RESPONSE")
        return ticket
    except PlaywrightError as error:
        raise E2eFailure("CLERK_TICKET_BROKER_UNAVAILABLE") from error


def switch_account(
    page: Page,
    base_url: str,
    role: str,
    broker_secret: str,
) -> None:
    destination = "teacher" if role == "teacher" else "student"
    broker_role = role.upper()
    for attempt in range(1, 4):
        page.goto(base_url, wait_until="domcontentloaded")
        page.wait_for_function(
            """() =>
              Boolean(window.Clerk?.loaded && window.Clerk.status === 'ready')
            """,
            timeout=60_000,
        )
        try:
            ticket = request_clerk_ticket(page, broker_role, broker_secret)
            page.evaluate(
                """async ticket => {
                  const clerk = window.Clerk;
                  if (!clerk?.loaded) throw new Error('CLERK_NOT_READY');
                  await clerk.signOut();
                  let signIn = clerk.client?.signIn;
                  for (let attempt = 0; !signIn && attempt < 50; attempt += 1) {
                    await new Promise((resolve) => window.setTimeout(resolve, 100));
                    signIn = clerk.client?.signIn;
                  }
                  if (!signIn) throw new Error('CLERK_CLIENT_NOT_READY');
                  const signInAttempt = await signIn.create({
                    strategy: 'ticket',
                    ticket,
                  });
                  if (
                    signInAttempt.status !== 'complete' ||
                    !signInAttempt.createdSessionId
                  ) {
                    throw new Error('CLERK_TICKET_INCOMPLETE');
                  }
                  await clerk.setActive({
                    session: signInAttempt.createdSessionId,
                  });
                }""",
                ticket,
            )
            page.goto(
                f"{base_url}/{destination}",
                wait_until="domcontentloaded",
            )
        except (E2eFailure, PlaywrightError):
            if attempt < 3:
                page.wait_for_timeout(1_000)
                continue
            raise E2eFailure("CLERK_SWITCH_RETRY_EXHAUSTED")

        if urlparse(page.url).path == f"/{destination}":
            page.wait_for_load_state("domcontentloaded")
            return

    raise E2eFailure("CLERK_SWITCH_RETRY_EXHAUSTED")


def screenshot(page: Page, artifacts: Path, name: str) -> None:
    page.screenshot(path=artifacts / f"{name}.png", full_page=True)


def fill_activity_form(page: Page, title: str, summary: str) -> None:
    page.locator('#activity-draft-form[data-hydrated="true"]').wait_for(state="visible")
    page.locator("#activity-title").fill(title)
    page.locator("#activity-summary").fill(summary)
    page.get_by_label("探究主题", exact=True).fill("校园证据核验")
    page.get_by_label("背景设定", exact=True).fill(
        "学生受邀核验校园观察记录，并以可复验的数据说明结论。"
    )
    page.get_by_label("知识与技能目标", exact=True).fill("识别可核验的观察证据。")
    page.get_by_label("过程与方法目标", exact=True).fill("根据记录比较证据并形成解释。")
    page.get_by_label("情感态度目标", exact=True).fill("愿意诚实记录并听取同伴意见。")
    page.get_by_label("总体任务说明", exact=True).fill(
        "完成一次校园观察，记录数据，并用文字说明证据如何支持结论。"
    )

    phase_actions = (
        "提出一个可以通过观察验证的问题。",
        "收集并比较至少两项观察记录。",
        "用证据表达结论并回应同伴质疑。",
    )
    for index, action in enumerate(phase_actions):
        phase = page.get_by_role("group", name=f"阶段 {index + 1}", exact=True)
        phase.get_by_label("核心动作", exact=True).fill(action)
        phase.get_by_label("情境承接", exact=True).fill(
            f"承接校园证据核验任务的第 {index + 1} 步。"
        )
        phase.get_by_label("学习支架", exact=True).fill(
            "使用问题、记录、证据、结论四栏表。"
        )
        phase.get_by_label("提交证据说明", exact=True).fill(
            f"第 {index + 1} 阶段的文字记录与依据。"
        )
        phase.get_by_label("评价要点", exact=True).fill(
            "记录可核验，结论与证据一致。"
        )

    for index in range(4):
        rubric = page.get_by_role("group", name=f"维度 {index + 1}", exact=True)
        rubric.get_by_label("优秀", exact=True).fill("证据完整且解释清晰。")
        rubric.get_by_label("良好", exact=True).fill("主要证据完整，解释基本清晰。")
        rubric.get_by_label("合格", exact=True).fill("有基本证据和可理解的解释。")
        rubric.get_by_label("需改进", exact=True).fill("证据或解释仍需补充。")


def fill_feedback_when_ready(page: Page, body: str) -> None:
    """Fill after hydration and prove React enabled the confirmation action."""
    textarea = page.locator("#teacher-feedback-body")
    button = page.get_by_role("button", name="准备确认", exact=True)
    textarea.wait_for(state="visible")
    button.wait_for(state="visible")

    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        textarea.fill(body)
        if textarea.input_value() == body and button.is_enabled():
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
    broker_secret: str,
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
            switch_account(page, base_url, "teacher", broker_secret)
            foreign_response = page.goto(
                f"{base_url}/teacher/activities/{FOREIGN_DRAFT_ID}",
                wait_until="domcontentloaded",
            )
            if not foreign_response or foreign_response.status != 404:
                raise E2eFailure("FOREIGN_TEACHER_DRAFT_NOT_HIDDEN")

            page.goto(f"{base_url}/teacher", wait_until="domcontentloaded")
            page.get_by_role("link", name="新建学习活动", exact=True).click()
            page.wait_for_url(f"{base_url}/teacher/activities/new")

            fill_activity_form(
                page,
                title,
                "第一版摘要：建立可复验的学习证据。",
            )
            page.get_by_role("button", name="保存为编辑中", exact=True).click()
            page.wait_for_url(re.compile(rf"{re.escape(base_url)}/teacher/activities/[0-9a-f-]+$"))
            page.locator('#activity-draft-form[data-hydrated="true"]').wait_for(state="visible")
            if page.locator('input[name="expectedVersion"]').input_value() != "1":
                raise E2eFailure("DRAFT_VERSION_ONE_NOT_RENDERED")

            page.locator("#activity-summary").fill(
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
                "button", name="准备精确发布确认", exact=True
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

            switch_account(page, base_url, "student", broker_secret)
            student_release_link = page.get_by_role(
                "link", name=f"打开活动：{title}", exact=True
            )
            student_release_href = student_release_link.get_attribute("href")
            if not student_release_href:
                raise E2eFailure("STUDENT_RELEASE_LINK_MISSING")
            student_release_link.click()
            page.locator("#text-evidence").fill(first_evidence)
            page.get_by_role("button", name="保存草稿", exact=True).click()
            wait_for_text(page, "草稿已保存")
            page.get_by_role("button", name="正式提交", exact=True).click()
            confirm_dialog(page, "确认正式提交？", "确认正式提交")
            wait_for_text(page, "第 1 版已正式提交")
            screenshot(page, artifacts, "03-student-submitted-v1")

            denied_response = page.goto(
                f"{base_url}{release_href}", wait_until="domcontentloaded"
            )
            if not denied_response or denied_response.status != 404:
                raise E2eFailure("STUDENT_TEACHER_ROUTE_NOT_HIDDEN")
            if page.get_by_role("button", name="准备关闭活动", exact=True).count() != 0:
                raise E2eFailure("STUDENT_ACCESSED_TEACHER_RELEASE_CONTROL")

            switch_account(page, base_url, "teacher", broker_secret)
            page.goto(f"{base_url}{release_href}", wait_until="domcontentloaded")
            submission_link = page.get_by_role(
                "link", name=re.compile("查看与反馈")
            ).first
            submission_href = submission_link.get_attribute("href")
            if not submission_href:
                raise E2eFailure("SUBMISSION_LINK_MISSING")
            submission_link.click()
            fill_feedback_when_ready(page, first_feedback)
            page.get_by_role("button", name="准备确认", exact=True).click()
            confirm_dialog(page, "确认并保存最终反馈", "确认并保存最终反馈")
            page.get_by_label("第 1 版正式提交").get_by_text(
                first_feedback, exact=True
            ).wait_for(state="visible")

            switch_account(page, base_url, "student", broker_secret)
            page.goto(f"{base_url}{student_release_href}", wait_until="domcontentloaded")
            wait_for_text(page, first_feedback)
            page.get_by_role("button", name="开始重交", exact=True).click()
            page.locator("#text-evidence").wait_for(state="visible")
            page.locator("#text-evidence").fill(second_evidence)
            page.get_by_role("button", name="保存草稿", exact=True).click()
            wait_for_text(page, "草稿已保存")
            page.get_by_role("button", name="正式提交", exact=True).click()
            confirm_dialog(page, "确认正式提交？", "确认正式提交")
            wait_for_text(page, "第 2 版已正式提交")
            screenshot(page, artifacts, "04-student-resubmitted-v2")

            switch_account(page, base_url, "teacher", broker_secret)
            page.goto(f"{base_url}{submission_href}", wait_until="domcontentloaded")
            fill_feedback_when_ready(page, second_feedback)
            page.get_by_role("button", name="准备确认", exact=True).click()
            confirm_dialog(page, "确认并保存最终反馈", "确认并保存最终反馈")
            page.get_by_label("第 2 版正式提交").get_by_text(
                second_feedback, exact=True
            ).wait_for(state="visible")

            switch_account(page, base_url, "student", broker_secret)
            page.goto(
                f"{base_url}{student_release_href}",
                wait_until="domcontentloaded",
            )
            page.get_by_role("button", name="开始重交", exact=True).click()
            page.locator("#text-evidence").fill(third_evidence)
            page.get_by_role("button", name="保存草稿", exact=True).click()
            wait_for_text(page, "草稿已保存")

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
            wait_for_text(page, "历史成员 · 唯读")
            wait_for_text(
                page,
                "你当前保留这份活动与自己提交的唯读权限",
            )
            historical_textarea = page.locator("#text-evidence")
            historical_textarea.wait_for(state="visible")
            if (
                historical_textarea.input_value() != third_evidence
                or historical_textarea.is_editable()
            ):
                raise E2eFailure("HISTORICAL_MEMBER_WORKING_COPY_NOT_READONLY")
            for action_label in (
                "保存草稿",
                "正式提交",
                "正式迟交",
                "开始重交",
            ):
                if page.get_by_role(
                    "button", name=action_label, exact=True
                ).count() != 0:
                    raise E2eFailure("HISTORICAL_MEMBER_WRITE_ACTION_VISIBLE")
            wait_for_text(page, first_feedback)
            wait_for_text(page, second_feedback)
            screenshot(page, artifacts, "05-historical-member-readonly")

            switch_account(page, base_url, "teacher", broker_secret)
            page.goto(f"{base_url}{release_href}", wait_until="domcontentloaded")
            page.get_by_role("button", name="准备关闭活动", exact=True).click()
            confirm_dialog(page, "确认关闭这个活动", "确认并关闭活动")
            page.get_by_role(
                "button", name="准备关闭活动", exact=True
            ).wait_for(state="detached")
            screenshot(page, artifacts, "06-closed-by-teacher")

            switch_account(page, base_url, "student", broker_secret)
            page.goto(f"{base_url}{student_release_href}", wait_until="domcontentloaded")
            wait_for_text(page, "已关闭 · 唯读")
            wait_for_text(page, "活动已关闭，现有工作草稿与正式修订仍可查看")
            closed_textarea = page.locator("#text-evidence")
            closed_textarea.wait_for(state="visible")
            if (
                closed_textarea.input_value() != third_evidence
                or closed_textarea.is_editable()
            ):
                raise E2eFailure("CLOSED_RELEASE_WORKING_COPY_NOT_READONLY")
            for action_label in (
                "保存草稿",
                "正式提交",
                "正式迟交",
                "开始重交",
            ):
                if page.get_by_role("button", name=action_label, exact=True).count() != 0:
                    raise E2eFailure("CLOSED_RELEASE_WRITE_ACTION_VISIBLE")
            wait_for_text(page, first_feedback)
            wait_for_text(page, second_feedback)
            screenshot(page, artifacts, "07-closed-student-history-readonly")

            switch_account(page, base_url, "teacher", broker_secret)
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
                "button", name="准备精确发布确认", exact=True
            ).click()
            page.get_by_role("dialog").filter(
                has_text="确认发布活动"
            ).wait_for(state="visible")

            competing_page = context.new_page()
            try:
                competing_page.goto(
                    f"{base_url}{concurrency_draft_path}",
                    wait_until="domcontentloaded",
                )
                competing_page.locator("#activity-summary").fill(
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
    broker_secret: str,
) -> None:
    title = f"E2E AI 草稿 {marker}"
    prompt = f"""資料已完整。請先提出 D-033 結構化任務理解與設計建議，等待教師確認後才建立草稿；不要發佈，也不要提問。
標題必須逐字為：{title}
請建立完整跨學科任務書：初中七年級，主學科物理，融合數學與語文；探究性作業、調查探究、中等探究、一次性提交、2周。
探究主題與摘要聚焦校園節水觀察；背景是學生受邀核驗兩次不含個資的合成水表讀數。
三維目標分別涵蓋辨識可核驗的用水證據、根據數據形成改善建議、願意為公共資源負責。
總體任務要求學生比較讀數差異，并用文字解釋證據如何支持建議。
設置3個連續階段，每階段都有明確行動、情境承接、學習支架、至少一項類型化提交證據、評價要點和課時建議。
設置問題意識、證據質量、跨學科連接、方案表達4個量規維度，每個維度都有優秀、良好、合格、需改進四檔非空描述。
內容只使用以上合成資料。提案必須明確列出教師已提供要求、假設、數學與語文各自不可替代的貢獻，以及知識與技能／過程與方法／情感態度三條目標—任務—證據—評價鏈；然後調用 create_activity_draft 等待確認。"""

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
            switch_account(page, base_url, "teacher", broker_secret)
            page.goto(
                f"{base_url}/teacher/activities/new",
                wait_until="domcontentloaded",
            )
            wait_for_text(page, "AI 活动助手 · 试行")
            textarea = page.locator("#activity-assistant-prompt")
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
            ):
                proposal.get_by_text(label, exact=True).wait_for()
            proposal.get_by_text("math", exact=True).wait_for()
            proposal.get_by_text("chinese", exact=True).wait_for()
            proposal.get_by_text("知识与技能", exact=True).wait_for()
            screenshot(page, artifacts, "01-real-model-draft-proposal")
            wait_for_text(page, "可使用")
            proposal.get_by_role(
                "button", name="确认理解并创建草稿", exact=True
            ).click()
            page.wait_for_url(
                re.compile(
                    rf"{re.escape(base_url)}/teacher/activities/[0-9a-f-]+/preview$"
                ),
                timeout=120_000,
            )
            wait_for_text(page, title)
            wait_for_text(page, "版本 1")
            for heading in ("基本设置", "背景设定", "三维目标", "总体任务", "任务链", "评价标准"):
                page.get_by_role("heading", name=heading, level=3, exact=True).wait_for()
            if page.get_by_role(
                "link", name="查看发布与学生提交", exact=True
            ).count() != 0:
                raise E2eFailure("REAL_MODEL_SMOKE_CREATED_RELEASE")
            screenshot(page, artifacts, "02-real-model-draft-preview")
        except Exception:
            screenshot(page, artifacts, "failure")
            raise
        finally:
            context.close()
            browser.close()


def main() -> int:
    real_model_smoke = use_real_model_smoke()
    marker = run_marker(real_model_smoke=real_model_smoke)
    broker_secret = secrets.token_urlsafe(32)
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
    runtime_environment = dict(environment)
    runtime_environment.update(
        {
            "DATABASE_URL": e2e_database_url,
            "DIRECT_URL": e2e_database_url,
            "AI_PROVIDER_DISABLED": "0" if real_model_smoke else "1",
            "E2E_CLERK_TICKET_SECRET": broker_secret,
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
                environment=environment,
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
            environment=environment,
        )

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
                    broker_secret,
                )
            else:
                run_browser_flow(
                    base_url,
                    marker,
                    artifacts,
                    environment,
                    broker_secret,
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
            environment=environment,
            capture_output=True,
        )
        evidence = json.loads(verification.stdout)
        result = {
            "ok": True,
            "marker": marker,
            "browser": "chromium-headless",
            "authentication": "clerk-development-session-ticket",
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


if __name__ == "__main__":
    raise SystemExit(main())
