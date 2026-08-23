from playwright.sync_api import sync_playwright


CHECKS = [
    ("/", "home-1440", 1440, 900),
    ("/", "home-390", 390, 844),
    ("/teacher", "teacher-1440", 1440, 900),
    ("/teacher", "teacher-390", 390, 844),
    ("/student", "student-1440", 1440, 900),
    ("/student", "student-390", 390, 844),
]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for route, name, width, height in CHECKS:
        page = browser.new_page(viewport={"width": width, "height": height})
        errors = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.goto(f"http://127.0.0.1:3000{route}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(400)
        audit = page.evaluate(
            """() => {
              const leaves = [...document.querySelectorAll('body *')]
                .filter((element) => element.childElementCount === 0 && element.textContent.trim());
              const sizes = leaves.map((element) => parseFloat(getComputedStyle(element).fontSize)).filter(Boolean);
              const controls = [...document.querySelectorAll('button,input:not([type=hidden]),select,textarea')]
                .filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
              return {
                overflow: document.documentElement.scrollWidth > window.innerWidth,
                minFont: Math.min(...sizes),
                undersized: controls.filter((element) => element.getBoundingClientRect().height < 44)
                  .map((element) => ({ tag: element.tagName, text: (element.innerText || element.getAttribute('aria-label') || element.name || '').trim(), height: Math.round(element.getBoundingClientRect().height) })),
                controls: controls.length,
              };
            }"""
        )
        page.screenshot(path=f"artifacts/ui-audit/topbar/{name}.png", full_page=True)
        print(name, audit, "consoleErrors", len(errors))
        page.close()
    browser.close()
