"""跨全部路由的界面审查：字号层级、对比度、溢出、点击区、行长、状态样式。"""
import json
import os
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
DEMO_SCHOOL_CODE = "SCHARCHX"
DEMO_TEACHER_ACCOUNT = "T-DEMO"
DEMO_STUDENT_ACCOUNT = "700001"

TEACHER_ROUTES = [
    ("首页", "/"),
    ("教师工作台", "/teacher"),
    ("活动设计·新建", "/teacher/activities/new"),
    ("活动设计·编辑中", "/teacher/activities/8170a39a-77ad-4104-9c1e-67a5aca1a9dd"),
    ("发布确认", "/teacher/activities/8170a39a-77ad-4104-9c1e-67a5aca1a9dd/preview"),
    ("过程诊断", "/teacher/insights"),
    ("课程依据", "/teacher/knowledge"),
    ("班级与名单", "/teacher/classrooms/7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e01/members"),
    ("评阅名册", "/teacher/releases/75e064aa-efe5-44f5-a0b5-4b4fb91447b9/submissions"),
    ("反馈与评价", "/teacher/submissions/ca0de124-a491-4cbf-8a5d-f0f97c15d49f"),
]
STUDENT_ROUTES = [
    ("学生·我的活动", "/student"),
    ("学生·活动详情", "/student/releases/75e064aa-efe5-44f5-a0b5-4b4fb91447b9"),
]

AUDIT = r"""
() => {
  const SCALE = [42,32,25,20,16,15,14,13,12];
  const parse = s => {
    if (!s) return null;
    const n = s.match(/[\d.]+/g); if (!n) return null;
    if (s.startsWith('color(')) { const v = n.map(Number); const a = v.length > 3 ? v[3] : 1; return [v[0]*255, v[1]*255, v[2]*255, a]; }
    const v = n.map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
  };
  const over = (fg, bg) => fg.slice(0,3).map((c,i) => c*fg[3] + bg[i]*(1-fg[3]));
  const bgOf = el => {
    let n = el, stack = [];
    while (n && n !== document.documentElement) { const p = parse(getComputedStyle(n).backgroundColor); if (p && p[3] > 0) { stack.push(p); if (p[3] === 1) break; } n = n.parentElement; }
    let base = [243,242,242];
    for (const layer of stack.reverse()) base = over(layer, base);
    return base;
  };
  const lum = c => { const s = c.slice(0,3).map(x => { x = x/255; return x <= .03928 ? x/12.92 : Math.pow((x+.055)/1.055, 2.4); }); return .2126*s[0]+.7152*s[1]+.0722*s[2]; };
  const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); const hi = Math.max(a,b), lo = Math.min(a,b); return +(((hi+.05)/(lo+.05)).toFixed(2)); };
  const out = { contrast: [], offScale: [], clipped: [], tinyTarget: [], longMeasure: [], sizesSeen: {} };
  const seen = new Set();
  const name = el => el.tagName.toLowerCase() + (String(el.className).split(' ')[0] ? '.' + String(el.className).split(' ')[0].replace(/^.*__/, '') : '');
  document.querySelectorAll('body *').forEach(el => {
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return;
    const r = el.getBoundingClientRect();
    const text = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join('');
    const fs = Math.round(parseFloat(c.fontSize));
    if (text && r.width > 0) {
      out.sizesSeen[fs] = (out.sizesSeen[fs] || 0) + 1;
      if (!SCALE.includes(fs)) { const k = 'S'+fs+name(el); if (!seen.has(k)) { seen.add(k); out.offScale.push(fs + 'px ' + name(el) + ' "' + text.slice(0,14) + '"'); } }
      const fg = parse(c.color); const cr = ratio(over(fg, bgOf(el)), bgOf(el));
      const large = fs >= 24 || (fs >= 19 && +c.fontWeight >= 600);
      if (cr < (large ? 3 : 4.5)) { const k = 'C'+name(el)+cr; if (!seen.has(k)) { seen.add(k); out.contrast.push(cr + ':1 ' + fs + 'px ' + name(el) + ' "' + text.slice(0,14) + '"'); } }
      if (text.length > 30) { const ch = r.width / (fs * 0.55); if (ch > 95) { const k='M'+name(el); if(!seen.has(k)){seen.add(k); out.longMeasure.push(Math.round(ch) + 'ch ' + name(el)); } } }
    }
    if (el.scrollWidth > el.clientWidth + 2 && c.overflowX === 'visible' && r.width > 0 && el.children.length === 0)
      { const k='X'+name(el); if(!seen.has(k)){seen.add(k); out.clipped.push(name(el) + ' ' + el.scrollWidth + '>' + el.clientWidth + ' "' + (el.textContent||'').trim().slice(0,18) + '"'); } }
    if (/^(button|a|select|input|textarea)$/.test(el.tagName.toLowerCase()) && r.width > 0 && r.height > 0 && r.height < 28 && el.getAttribute('type') !== 'checkbox')
      { const k='T'+name(el)+Math.round(r.height); if(!seen.has(k)){seen.add(k); out.tinyTarget.push(Math.round(r.height) + 'px ' + name(el) + ' "' + (el.textContent||'').trim().slice(0,12) + '"'); } }
  });
  out.pageOverflow = document.documentElement.scrollWidth > window.innerWidth + 1 ? document.documentElement.scrollWidth + '>' + window.innerWidth : null;
  return out;
}
"""

def loopback_origin(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("UI_AUDIT_BASE_NOT_LOOPBACK")
    return f"{parsed.scheme}://{parsed.netloc}"


def login(page, role: str, password: str) -> None:
    login_path, destination, account_label, account = (
        ("/teacher/login", "/teacher", "工号", DEMO_TEACHER_ACCOUNT)
        if role == "TEACHER"
        else ("/student/login", "/student", "学号", DEMO_STUDENT_ACCOUNT)
    )
    expected_origin = loopback_origin(BASE)
    password_field = page.get_by_label("密码", exact=True)
    try:
        page.goto(BASE + login_path, wait_until="networkidle")
        page.get_by_label("学校代码", exact=True).fill(DEMO_SCHOOL_CODE)
        page.get_by_label(account_label, exact=True).fill(account)
        password_field.fill(password)
        page.get_by_role("button", name="登录", exact=True).click()
        page.wait_for_url(BASE + destination, wait_until="networkidle")
        if page.url != BASE + destination:
            raise RuntimeError("DESTINATION")
        if loopback_origin(page.url) != expected_origin:
            raise RuntimeError("ORIGIN")
    except Exception:
        raise RuntimeError(f"UI_AUDIT_{role}_LOGIN_FAILED") from None
    finally:
        try:
            password_field.fill("")
        except Exception:
            pass


def required_password(role: str) -> str:
    variable = f"DEV_TEST_DEMO_{role}_PASSWORD"
    value = os.environ.get(variable, "")
    if not value:
        raise RuntimeError(f"UI_AUDIT_{role}_PASSWORD_REQUIRED")
    return value

def run(widths):
    findings = {}
    passwords = {
        "TEACHER": required_password("TEACHER"),
        "STUDENT": required_password("STUDENT_1"),
    }
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for role, routes in (("TEACHER", TEACHER_ROUTES), ("STUDENT", STUDENT_ROUTES)):
            ctx = browser.new_context(viewport={"width": widths[0], "height": 900})
            page = ctx.new_page()
            try:
                login(page, role, passwords[role])
                for w in widths:
                    page.set_viewport_size({"width": w, "height": 900})
                    for label, path in routes:
                        page.goto(BASE + path, wait_until="networkidle")
                        page.wait_for_timeout(250)
                        res = page.evaluate(AUDIT)
                        key = f"{label} @{w}"
                        hits = {k: v for k, v in res.items() if k not in ("sizesSeen",) and v}
                        if hits:
                            findings[key] = hits
                        findings.setdefault("__sizes", {}).update({str(k): 1 for k in res["sizesSeen"]})
            finally:
                ctx.close()
        browser.close()
    return findings

if __name__ == "__main__":
    try:
        widths = [int(x) for x in (sys.argv[1:] or ["1280"])]
        print(json.dumps(run(widths), ensure_ascii=False, indent=1))
    except RuntimeError as error:
        print(error.args[0] if error.args else "UI_AUDIT_FAILED", file=sys.stderr)
        raise SystemExit(1)
