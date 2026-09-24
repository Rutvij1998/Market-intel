#!/usr/bin/env python3
"""Turn Market-Vantage PDF jobs into PDFs with Playwright (Python).

Replaces PDFKit. Two jobs, same results as before:

  screenshots — full-page PNGs scaled to letter width and sliced vertically
  alert       — the thread digest (title, filters, each match, footer)

stdin: one JSON object. stdout: raw PDF bytes. Errors go to stderr.

  python3 scripts/pdf_convert.py < job.json > out.pdf

Requires: pip install 'playwright==1.58.*' && python3 -m playwright install chromium
"""

from __future__ import annotations

import html
import json
import math
import sys

from playwright.sync_api import sync_playwright

# Letter, in PDF points. Same numbers PDFKit used.
LETTER_W = 612.0
LETTER_H = 792.0
MAX_PAGE_H = LETTER_H


def pt(value: float) -> str:
    return f"{value:.2f}pt"


def esc(value: object) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def screenshot_pages(shots: list[dict]) -> str:
    """Same geometry as the old PDFKit slicer: fit letter width, never upscale, clip tall shots."""
    if not shots:
        return f"""
        <style>
          @page empty {{ size: {pt(LETTER_W)} {pt(LETTER_H)}; margin: 48pt; }}
          html, body {{ margin: 0; padding: 0; }}
          section {{
            page: empty;
            font-family: Helvetica, Arial, sans-serif;
            font-size: 14pt;
            color: #1a0b3d;
          }}
        </style>
        <section>No screenshots captured.</section>
        """

    css: list[str] = [
        "html, body { margin: 0; padding: 0; }",
        "section { position: relative; overflow: hidden; }",
        "section img { position: absolute; left: 0; display: block; }",
    ]
    body: list[str] = []
    page_i = 0

    for shot in shots:
        width = float(shot.get("width") or 0) or 1440.0
        height = float(shot.get("height") or 0) or 900.0
        scale = min(1.0, LETTER_W / width)
        scaled_w = width * scale
        scaled_h = height * scale
        src = esc(shot.get("pngBase64") or "")

        if scaled_h <= MAX_PAGE_H:
            page_h = max(scaled_h, 200.0)
            name = f"s{page_i}"
            page_i += 1
            css.append(f"@page {name} {{ size: {pt(scaled_w)} {pt(page_h)}; margin: 0; }}")
            body.append(
                f'<section style="page:{name}; width:{pt(scaled_w)}; height:{pt(page_h)};">'
                f'<img style="width:{pt(scaled_w)}; height:{pt(scaled_h)}; top:0;" '
                f'src="data:image/png;base64,{src}" alt="" />'
                f"</section>"
            )
            continue

        page_count = math.ceil(scaled_h / MAX_PAGE_H)
        for i in range(page_count):
            slice_h = min(MAX_PAGE_H, scaled_h - i * MAX_PAGE_H)
            name = f"s{page_i}"
            page_i += 1
            css.append(f"@page {name} {{ size: {pt(scaled_w)} {pt(slice_h)}; margin: 0; }}")
            body.append(
                f'<section style="page:{name}; width:{pt(scaled_w)}; height:{pt(slice_h)};">'
                f'<img style="width:{pt(scaled_w)}; height:{pt(scaled_h)}; top:{-i * MAX_PAGE_H:.2f}pt;" '
                f'src="data:image/png;base64,{src}" alt="" />'
                f"</section>"
            )

    return f"<style>{''.join(css)}</style>{''.join(body)}"


def alert_pages(job: dict) -> str:
    matches = job.get("matches") or []
    items: list[str] = []
    for match in matches:
        url = str(match.get("url") or "")
        link = ""
        if url.startswith("http://") or url.startswith("https://"):
            href = esc(url)
            link = f'<a href="{href}">{href}</a>'
        items.append(
            "<article>"
            f"<h3>{esc(match.get('heading'))}</h3>"
            f"<p class='meta'>{esc(match.get('meta'))}</p>"
            f"<p class='meta'>{esc(match.get('when'))}</p>"
            f"<p class='body'>{esc(match.get('body'))}</p>"
            f"{link}"
            "</article>"
        )

    if items:
        threads = "".join(items)
        footer = f"<footer>{esc(job.get('footer'))}</footer>"
    else:
        threads = f"<p class='body'>{esc(job.get('emptyMessage'))}</p>"
        footer = ""

    return f"""
    <style>
      @page {{ size: letter; margin: 48pt; }}
      html, body {{
        margin: 0; padding: 0;
        font-family: Helvetica, Arial, sans-serif;
        color: #1a0b3d;
      }}
      h1 {{
        margin: 0 0 8pt;
        font-size: 18pt;
        color: #3200BE;
      }}
      h2 {{
        margin: 0 0 14pt;
        font-size: 14pt;
        font-weight: normal;
        color: #1a0b3d;
      }}
      .meta {{
        margin: 0;
        font-size: 9pt;
        color: #5c5470;
      }}
      .filters {{
        margin: 10pt 0 18pt;
        font-size: 11pt;
      }}
      .filters strong {{
        display: block;
        color: #3200BE;
        margin-bottom: 2pt;
      }}
      article {{
        break-inside: avoid;
        page-break-inside: avoid;
        margin: 0 0 16pt;
        max-width: 500pt;
      }}
      h3 {{
        margin: 0 0 2pt;
        font-size: 11pt;
        color: #3200BE;
      }}
      .body {{
        margin: 6pt 0 0;
        font-size: 9pt;
        color: #1a0b3d;
        max-width: 500pt;
      }}
      a {{
        display: block;
        margin-top: 2pt;
        font-size: 9pt;
        color: #3200BE;
        max-width: 500pt;
        word-break: break-all;
      }}
      footer {{
        margin-top: 18pt;
        font-size: 8pt;
        color: #5c5470;
        max-width: 500pt;
      }}
    </style>
    <h1>Market Vantage</h1>
    <h2>New thread alert report</h2>
    <p class="meta">Generated: {esc(job.get('generated'))}</p>
    <p class="meta">Period: since {esc(job.get('since'))}</p>
    <p class="meta">Matches: {esc(job.get('matchCount'))}</p>
    <div class="filters">
      <strong>Your filters (only these are included)</strong>
      <span>{esc(job.get('filters') or '—')}</span>
    </div>
    {threads}
    {footer}
    """


def render(job: dict) -> bytes:
    kind = job.get("kind")
    if kind == "screenshots":
        markup = screenshot_pages(job.get("shots") or [])
    elif kind == "alert":
        markup = alert_pages(job)
    else:
        raise SystemExit(f"Unknown PDF kind: {kind}")

    html_doc = f"<!doctype html><html><head><meta charset='utf-8'></head><body>{markup}</body></html>"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.set_content(html_doc, wait_until="load")
            return page.pdf(
                print_background=True,
                prefer_css_page_size=True,
                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
            )
        finally:
            browser.close()


def main() -> None:
    raw = sys.stdin.buffer.read()
    job = json.loads(raw.decode("utf-8"))
    pdf = render(job)
    if not pdf.startswith(b"%PDF"):
        raise SystemExit("Playwright did not return a PDF")
    sys.stdout.buffer.write(pdf)


if __name__ == "__main__":
    main()
