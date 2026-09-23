import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "web" / "styles.css").read_text(encoding="utf-8")
REPORT = (ROOT / "web" / "report.js").read_text(encoding="utf-8")
APP = (ROOT / "web" / "app.js").read_text(encoding="utf-8")

# This is an optional browser smoke test. It renders the real frontend and mocks only the HTTP layer.
html = HTML.replace('<link rel="manifest" href="/manifest.webmanifest" />', '')
html = html.replace('<link rel="icon" href="/icon.svg" type="image/svg+xml" />', '')
html = html.replace('<link rel="stylesheet" href="/styles.css" />', '')
html = html.replace('  <script src="/report.js" defer></script>\n  <script src="/app.js" defer></script>', '')

FETCH_STUB = r"""
window.__record = null;
window.__copied = '';
window.confirm = () => true;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });
window.fetch = async (path, options = {}) => {
  const json = (status, payload) => Promise.resolve(new Response(JSON.stringify(payload), {status, headers:{'Content-Type':'application/json'}}));
  if (path === '/api/session') return json(200, {authenticated:true});
  if (path === '/api/today') return json(200, {date:'2026-09-23', server_now:'2026-09-23T12:00:00+07:00', timezone:'Asia/Bangkok', record:window.__record});
  if (path.startsWith('/api/records?')) return json(200, {records:window.__record ? [window.__record] : []});
  if (path === '/api/clock') {
    const body = JSON.parse(options.body || '{}');
    const field = body.action === 'in' ? 'clock_in' : 'clock_out';
    if (window.__record && window.__record[field] && body.replace !== true) return json(409, {error:'already_exists', field, record:window.__record});
    window.__record ||= {date:'2026-09-23', clock_in:null, clock_out:null, updated_at:'2026-09-23T12:00:00+07:00'};
    window.__record[field] = body.action === 'in' ? '11:03' : '21:18';
    return json(200, {ok:true, record:window.__record});
  }
  if (path.startsWith('/api/records/') && options.method === 'PUT') {
    const body = JSON.parse(options.body || '{}');
    window.__record = {date:body.date, clock_in:body.clock_in, clock_out:body.clock_out, updated_at:'2026-09-23T12:00:00+07:00'};
    return json(200, {ok:true, record:window.__record});
  }
  if (path.startsWith('/api/records/') && options.method === 'DELETE') {
    window.__record = null;
    return json(200, {ok:true});
  }
  return json(404, {error:'not_found'});
};
"""


def main():
    chromium = os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=chromium, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 390, "height": 844})
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.set_content(html, wait_until="domcontentloaded")
        page.add_style_tag(content=CSS)
        page.add_script_tag(content=FETCH_STUB)
        page.add_script_tag(content=REPORT)
        page.add_script_tag(content=APP)
        page.wait_for_selector("#appView:not(.hidden)")

        dims = page.evaluate("""() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
          inH: document.querySelector('#clockInBtn').getBoundingClientRect().height,
          outH: document.querySelector('#clockOutBtn').getBoundingClientRect().height,
          copyH: document.querySelector('#copyBtn').getBoundingClientRect().height
        })""")
        assert dims["sw"] <= dims["cw"], dims
        assert dims["inH"] >= 96 and dims["outH"] >= 96 and dims["copyH"] >= 48, dims
        assert "ประวัติลงเวลา" in page.locator("body").inner_text()

        page.click("#clockInBtn")
        page.wait_for_timeout(80)
        assert page.locator("#clockInValue").inner_text() == "11:03"
        page.click("#clockInBtn")
        page.wait_for_selector("#confirmModal:not(.hidden)")
        assert "ถูกบันทึกไว้" in page.locator("#confirmText").inner_text()
        page.click("#confirmCancel")

        page.click("#clockOutBtn")
        page.wait_for_timeout(80)
        assert page.locator("#clockOutValue").inner_text() == "21:18"
        assert page.locator("#statusPill b").inner_text() == "COMPLETED"

        page.click("#copyBtn")
        page.wait_for_timeout(50)
        expected = "23/9/69 เข้า 11:03น.\n23/9/69 ออก 21:18น."
        assert page.evaluate("window.__copied") == expected
        assert "คัดลอกแล้ว" in page.locator("#toast").inner_text()

        page.click('.record-actions button[aria-label^="แก้ไข"]')
        page.fill("#editIn", "10:15")
        page.click('#editForm button[type="submit"]')
        page.wait_for_timeout(80)
        assert page.locator(".record-time b").first.inner_text() == "10:15"

        page.click('.record-actions button[aria-label^="ลบ"]')
        page.wait_for_timeout(80)
        assert page.locator("#emptyState").is_visible()
        assert not errors, errors
        page.screenshot(path=str(ROOT / "tests" / "mobile_preview.png"), full_page=True)
        browser.close()
        print("PASS frontend smoke", dims)


if __name__ == "__main__":
    main()
