#!/usr/bin/env python3
"""Re-take the four Aurelia Wings staged screenshots with a real browser.

Serves game/ locally, opens ?shot=<name> for each staged shot, waits for
window.__shotReady (the in-game autopilot freezes the frame), then saves
a JPEG into screenshots/. Also reports console errors / page errors /
failed requests: the game must run clean and offline.
Usage: python3 shots.py [cover|cockpit|lighthouse|final ...] (default: all)
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8901
SHOTS = ["cover", "cockpit", "lighthouse", "final"]

names = sys.argv[1:] or SHOTS
for n in names:
    assert n in SHOTS, f"unknown shot {n}"

srv = subprocess.Popen(["node", "serve.ts", "--port", str(PORT)], cwd=ROOT,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
errors = []
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
            "--no-sandbox",
        ])
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
                    if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url} {r.failure}"))
        for name in names:
            i = SHOTS.index(name) + 1
            page.goto(f"http://127.0.0.1:{PORT}/?shot={name}", wait_until="load")
            try:
                page.wait_for_function("window.__shotReady === true", timeout=30000)
            except Exception as e:
                errors.append(f"{name}: __shotReady timeout: {e}")
            page.wait_for_timeout(400)
            out = os.path.join(ROOT, "screenshots", f"{i:02d}-{name}.jpg")
            page.screenshot(path=out, type="jpeg", quality=82)
            print("saved", out, os.path.getsize(out), "bytes")
        browser.close()
finally:
    srv.terminate()
    try:
        out, _ = srv.communicate(timeout=5)
        if out.strip():
            print("server log:", out.strip()[:500])
    except Exception:
        srv.kill()
print("ERRORS:" if errors else "NO CONSOLE/PAGE/REQUEST ERRORS")
for e in errors:
    print(" ", e)
