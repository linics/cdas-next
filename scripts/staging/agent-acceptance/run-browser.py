"""Protected Agent acceptance browser runner. It is intentionally never invoked by unit tests."""
from __future__ import annotations
import hashlib, ipaddress, json, os, re, subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

SCREENSHOTS=("01-ready.png","02-approval.png","03-published.png","04-release.png")
CREATE_PROMPT="""立即调用 create_activity_draft 工具，不要提问。标题必须逐字为：{title}。摘要必须逐字为：固定合成验收摘要。学习目标数组必须恰一个值：识别合成证据。任务说明必须逐字为：提交固定合成内容。证据要求数组必须恰一个值：合成文本。反馈标准数组必须恰一个值：固定标准。不得增删或改写任何字段；完成后立即创建版本1。"""
PUBLISH_PROMPT="立即调用 publish_activity_release 工具，将版本1发布到班级：{classroom}。无截止日期。"
def public_hostname(host: str) -> bool:
    host=host.strip().strip("[]").lower().rstrip(".")
    if not host or host=="localhost" or host.endswith((".localhost",".local",".internal",".lan")): return False
    try:
        ip=ipaddress.ip_address(host)
        cgnat = getattr(ip, "version", 0) == 4 and int(ip) >= int(ipaddress.ip_address("100.64.0.0")) and int(ip) <= int(ipaddress.ip_address("100.127.255.255"))
        return not (cgnat or ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved)
    except ValueError:
        return bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+",host))
def exact_origin(candidate: str, expected: str) -> bool:
    try:
        candidate_url=urlsplit(candidate); expected_url=urlsplit(expected)
        candidate_port=candidate_url.port or (443 if candidate_url.scheme.lower()=="https" else 80)
        expected_port=expected_url.port or (443 if expected_url.scheme.lower()=="https" else 80)
        return candidate_url.scheme.lower()==expected_url.scheme.lower() and candidate_url.hostname==expected_url.hostname and candidate_port==expected_port and candidate_url.username is None and candidate_url.password is None
    except ValueError:
        return False
def canonical_origin(value: str) -> str:
    parsed=urlsplit(value); port=parsed.port or (443 if parsed.scheme.lower()=="https" else 80)
    hostname=parsed.hostname or ""; rendered_host=f"[{hostname}]" if ":" in hostname else hostname
    default_port=(parsed.scheme.lower()=="https" and port==443) or (parsed.scheme.lower()=="http" and port==80)
    return f"{parsed.scheme.lower()}://{rendered_host}{'' if default_port else f':{port}'}"
def assert_origin(candidate: str, expected: str) -> None:
    if not exact_origin(candidate,expected): raise RuntimeError("STAGING_AGENT_ACCEPTANCE_ORIGIN_MISMATCH")
def fail() -> None:
    print('{"schema":"staging-agent-acceptance-browser.v1","status":"FAIL"}'); raise SystemExit(1)
def marker() -> str:
    value=os.environ.get("STAGING_RUN_MARKER","").strip()
    if not re.fullmatch(r"cdas-staging-agent-[a-z0-9-]{8,80}",value): fail()
    return value
def output(marker_value:str)->Path: return Path("output/staging-agent-acceptance")/marker_value
def run(command:list[str], capture:bool=False)->str:
    result=subprocess.run(command,check=False,capture_output=capture,text=True)
    if result.returncode: fail()
    return result.stdout
def main() -> None:
    value=marker(); base=os.environ.get("STAGING_BASE_URL","").rstrip("/")
    if not re.fullmatch(r"https://[^/?#]+/?",base) or not public_hostname(base.split("//",1)[1].rstrip("/")): fail()
    run(["pnpm","staging:agent:assert-browser-prerequisites"])
    started=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
    # Import is deliberately deferred: no test or prerequisite path opens a browser.
    from playwright.sync_api import sync_playwright
    directory=output(value); directory.mkdir(parents=True,exist_ok=True)
    title=f"CDAS staging Agent acceptance {value}"
    browser=None; context=None; page=None
    try:
      with sync_playwright() as p:
        browser=p.chromium.launch(); context=browser.new_context(); page=context.new_page(); page.set_default_timeout(30000)
        page.goto(base)
        assert_origin(page.url,base)
        page.wait_for_function("() => Boolean(window.Clerk?.loaded && window.Clerk.status === 'ready' && window.Clerk.client)", timeout=60000)
        assert_origin(page.url,base)
        # The 60-second capability is minted only after the final page origin is
        # locked, and is passed directly through Playwright's argument channel.
        ticket=run(["pnpm","staging:agent:issue-teacher-ticket"],True).strip()
        if not ticket or "\n" in ticket: raise RuntimeError("STAGING_AGENT_ACCEPTANCE_TICKET_INVALID")
        signed_in=page.evaluate("""async ({ ticket, expectedOrigin }) => {
          if (window.top !== window || window.location.origin !== expectedOrigin) return false;
          const clerk = window.Clerk;
          if (!clerk?.loaded || clerk.status !== 'ready' || !clerk.client) return false;
          const result = await clerk.client.signIn.create({ strategy: 'ticket', ticket });
          if (result.status !== 'complete' || !result.createdSessionId) return false;
          await clerk.setActive({ session: result.createdSessionId }); return true;
        }""", {"ticket":ticket,"expectedOrigin":canonical_origin(base)})
        if not signed_in: raise RuntimeError("STAGING_AGENT_ACCEPTANCE_SIGN_IN_FAILED")
        assert_origin(page.url,base)
        page.goto(f"{base}/teacher/activities/new")
        assert_origin(page.url,base)
        page.locator("#activity-assistant-prompt").fill(CREATE_PROMPT.format(title=title))
        page.get_by_role("button",name="交给助手整理").click(); page.wait_for_url(re.compile(r"/teacher/activities/.+/preview"),timeout=120000)
        assert_origin(page.url,base)
        page.get_by_role("heading",name=title,level=1,exact=True).wait_for(); page.get_by_text("草稿修订 1",exact=True).wait_for(); page.get_by_text("固定合成验收摘要",exact=True).wait_for(); page.get_by_text("识别合成证据",exact=True).wait_for(); page.get_by_text("提交固定合成内容",exact=True).wait_for(); page.get_by_text("合成文本",exact=True).wait_for(); page.get_by_text("固定标准",exact=True).wait_for(); page.screenshot(path=str(directory/SCREENSHOTS[0]),full_page=True)
        page.get_by_role("heading",name="继续核对活动并准备发布").wait_for()
        page.locator("#activity-assistant-prompt").fill(PUBLISH_PROMPT.format(classroom=f"CDAS staging Agent {value}"))
        page.get_by_role("button",name="交给助手整理").click(); approval=page.locator('[role="group"][aria-label="发布确认"]'); approval.get_by_role("button",name="确认并发布",exact=True).wait_for(timeout=120000); approval.get_by_text("版本 1",exact=True).wait_for(); approval.get_by_text(f"CDAS staging Agent {value}",exact=True).wait_for(); approval.get_by_text("未设置截止时间",exact=True).wait_for()
        page.screenshot(path=str(directory/SCREENSHOTS[1]),full_page=True); approval.get_by_role("button",name="确认并发布",exact=True).click()
        page.get_by_text("活动已发布").wait_for(timeout=120000); assert_origin(page.url,base); page.screenshot(path=str(directory/SCREENSHOTS[2]),full_page=True); page.get_by_role("link",name="查看学生提交").click(); page.wait_for_url(re.compile(r"/teacher/releases/[0-9a-f-]+"),timeout=30000)
        assert_origin(page.url,base)
        page.get_by_role("heading",name=title,level=1,exact=True).wait_for(); page.screenshot(path=str(directory/SCREENSHOTS[3]),full_page=True)
    except Exception:
      if page is not None:
        try: page.screenshot(path=str(directory/"failure.png"),full_page=True)
        except Exception: pass
      raise
    finally:
      if context is not None: context.close()
      if browser is not None: browser.close()
    completed=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
    hashes={name:hashlib.sha256((directory/name).read_bytes()).hexdigest() for name in SCREENSHOTS}
    evidence={"schema":"staging-agent-acceptance-browser.v1","status":"PASS","startedAt":started,"completedAt":completed,"checks":[{"code":f"SCREENSHOT_{index+1}","status":"PASS"} for index in range(4)],"screenshots":hashes,"realStudentDataAllowed":False,"productionDecision":"NO_GO"}
    (directory/"browser.json").write_text(json.dumps(evidence,indent=2)+"\n",encoding="utf8")
    print('{"schema":"staging-agent-acceptance-browser.v1","status":"PASS"}')
if __name__=="__main__":
    try: main()
    except SystemExit: raise
    except Exception:
        try:
            value=marker(); directory=output(value); directory.mkdir(parents=True,exist_ok=True)
            failure=directory/"failure.png"
            evidence={"schema":"staging-agent-acceptance-browser.v1","status":"FAIL","checks":[{"code":"STAGING_AGENT_ACCEPTANCE_BROWSER_FAILED","status":"FAIL"}],"screenshots":({"failure.png":hashlib.sha256(failure.read_bytes()).hexdigest()} if failure.is_file() else {}),"realStudentDataAllowed":False,"productionDecision":"NO_GO"}
            (directory/"browser.json").write_text(json.dumps(evidence,indent=2)+"\n",encoding="utf8")
        except Exception: pass
        fail()
