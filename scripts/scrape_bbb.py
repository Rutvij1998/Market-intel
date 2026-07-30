#!/usr/bin/env python3
"""
Generic BBB customer-reviews scraper (Cloudflare via cloudscraper).

Usage:
  python3 scripts/scrape_bbb.py --company Likewize
  python3 scripts/scrape_bbb.py --company Asurion --max-pages 1000

Prints JSON { reviews, pages, max_page_detected, errors, source_url } to stdout.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

PROFILES = {
    "Likewize": {
        "url": (
            "https://www.bbb.org/us/tx/southlake/profile/tech-support/"
            "likewize-corp-0825-1000202069/customer-reviews"
        ),
        "company": "Likewize",
    },
    "Asurion": {
        "url": (
            "https://www.bbb.org/us/tn/nashville/profile/insurance-companies/"
            "asurion-0573-2131781/customer-reviews"
        ),
        "company": "Asurion",
    },
}

try:
    import cloudscraper
except ImportError:
    print(
        json.dumps(
            {
                "error": "cloudscraper not installed. Run: pip3 install cloudscraper --user",
                "reviews": [],
            }
        )
    )
    sys.exit(1)


def parse_date(date_str: str) -> Optional[str]:
    if not date_str:
        return None
    date_str = date_str.strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y"):
        try:
            d = datetime.strptime(date_str, fmt)
            return d.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        except ValueError:
            continue
    return None


def extract_reviews(html: str, company: str, base_url: str) -> List[Dict[str, Any]]:
    reviews: List[Dict[str, Any]] = []
    card_re = re.compile(
        r'class="card bpr-review stack dtm-review"\s+id="([^"]+)"(.*?)(?=class="card bpr-review stack dtm-review"|aria-label="pagination"|$)',
        re.I | re.S,
    )
    for m in card_re.finditer(html):
        review_id = m.group(1).strip()
        body_html = m.group(2)

        name_m = re.search(
            r'bpr-review-title[^>]*>.*?<span[^>]*>\s*<span[^>]*>Review from</span>\s*([^<]+)',
            body_html,
            re.I | re.S,
        )
        if not name_m:
            name_m = re.search(r"Review from</span>\s*([^<]+)", body_html, re.I)
        author = name_m.group(1).strip() if name_m else "Anonymous"

        date_m = re.search(
            r"Date:</strong>\s*(?:<!--\s*-->\s*)?(\d{1,2}/\d{1,2}/\d{2,4})",
            body_html,
            re.I,
        )
        date_raw = date_m.group(1) if date_m else ""
        created_at = parse_date(date_raw) or datetime.now(timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )

        filled = len(re.findall(r'data-filled=""', body_html))
        if filled == 0:
            stars_m = re.search(r"(\d)\s*stars?", body_html, re.I)
            filled = int(stars_m.group(1)) if stars_m else 0
        rating = float(filled) if filled > 0 else None

        text = re.sub(r"<script[\s\S]*?</script>", " ", body_html, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
        text = re.sub(r"<svg[\s\S]*?</svg>", " ", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(r"^>?\s*", "", text)
        text = re.sub(r'^id="[^"]+"\s*', "", text)
        text = re.sub(
            r"^Review from\s+.+?Date:\s*\d{1,2}/\d{1,2}/\d{2,4}\s*",
            "",
            text,
            count=1,
            flags=re.I,
        )
        text = re.sub(r"^\d\s*stars?\s*", "", text, flags=re.I)
        text = re.split(
            r"\s+(?:Was this review helpful|Helpful\?|Report|Share|Business response)\b",
            text,
            maxsplit=1,
            flags=re.I,
        )[0]
        text = re.sub(r"\s*<?\s*li\s*$", "", text, flags=re.I).strip()
        text = re.sub(r"\s+", " ", text).strip()

        if len(text) < 8:
            continue

        reviews.append(
            {
                "id": f"bbb-{review_id}",
                "author": author,
                "text": text[:1500],
                "title": f"BBB review from {author}",
                "rating": rating,
                "created_at": created_at,
                "date_raw": date_raw,
                "url": f"{base_url}#{review_id}",
                "source": "BBB",
                "company": company,
            }
        )
    return reviews


def detect_max_page(html: str) -> int:
    # Prefer pagination nav (class bds-pagination) so we don't pick unrelated page= numbers
    nav = re.search(
        r'class="bds-pagination"[^>]*>(.*?)</(?:nav|div|ul)>',
        html,
        re.I | re.S,
    )
    blob = nav.group(1) if nav else html
    pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", blob)]
    # Also "Page 1000" text in nav
    pages += [int(x) for x in re.findall(r"Page\s+(\d+)", blob, re.I)]
    if not pages:
        pages = [int(x) for x in re.findall(r"customer-reviews\?page=(\d+)", html)]
    return max(pages) if pages else 1


def scrape(base_url: str, company: str, max_pages: int = 1000, delay: float = 1.0) -> Dict[str, Any]:
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "darwin", "mobile": False}
    )
    by_id: Dict[str, Dict[str, Any]] = {}
    max_page = 1
    pages_fetched = 0
    errors: List[str] = []
    empty_streak = 0

    try:
        r = scraper.get(base_url, timeout=45)
        r.raise_for_status()
        html = r.text
        detected = detect_max_page(html)
        max_page = min(detected, max_pages)
        revs = extract_reviews(html, company, base_url)
        for rev in revs:
            by_id[rev["id"]] = rev
        pages_fetched = 1
        print(
            f"[BBB:{company}] Page 1/{max_page} (detected {detected}): "
            f"+{len(revs)} ({len(by_id)} total)",
            file=sys.stderr,
        )
    except Exception as e:
        return {"error": f"Page 1 failed: {e}", "reviews": [], "pages": 0, "company": company}

    for page in range(2, max_page + 1):
        time.sleep(delay)
        url = f"{base_url}?page={page}"
        try:
            r = scraper.get(url, timeout=45)
            if r.status_code != 200:
                errors.append(f"page {page}: HTTP {r.status_code}")
                empty_streak += 1
                if empty_streak >= 3:
                    break
                continue
            revs = extract_reviews(r.text, company, base_url)
            before = len(by_id)
            for rev in revs:
                by_id[rev["id"]] = rev
            pages_fetched += 1
            added = len(by_id) - before
            print(
                f"[BBB:{company}] Page {page}/{max_page}: +{added} new from {len(revs)} "
                f"({len(by_id)} total)",
                file=sys.stderr,
            )
            if len(revs) == 0 or added == 0:
                empty_streak += 1
                if empty_streak >= 3:
                    print(f"[BBB:{company}] Stopping after empty streak.", file=sys.stderr)
                    break
            else:
                empty_streak = 0
        except Exception as e:
            errors.append(f"page {page}: {e}")
            print(f"[BBB:{company}] Page {page} failed: {e}", file=sys.stderr)
            empty_streak += 1
            if empty_streak >= 3:
                break

    return {
        "reviews": list(by_id.values()),
        "pages": pages_fetched,
        "max_page_detected": max_page,
        "errors": errors,
        "source_url": base_url,
        "company": company,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company", choices=list(PROFILES.keys()), default="Likewize")
    parser.add_argument("--url", default=None, help="Override reviews URL")
    parser.add_argument("--max-pages", type=int, default=1000)
    parser.add_argument("--delay", type=float, default=1.0)
    args = parser.parse_args()

    profile = PROFILES[args.company]
    base_url = args.url or profile["url"]
    company = profile["company"]
    result = scrape(base_url, company, max_pages=args.max_pages, delay=args.delay)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
