#!/usr/bin/env python3
"""
Scrape all Likewize Corp customer reviews from BBB (paginated).
BBB sits behind Cloudflare — uses cloudscraper to bypass.

Usage:
  python3 scripts/scrape_bbb_likewize.py
  python3 scripts/scrape_bbb_likewize.py --max-pages 70

Prints a JSON array of reviews to stdout.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

BASE_URL = (
    "https://www.bbb.org/us/tx/southlake/profile/tech-support/"
    "likewize-corp-0825-1000202069/customer-reviews"
)

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


def extract_reviews(html: str) -> List[Dict[str, Any]]:
    reviews: List[Dict[str, Any]] = []
    # Cards: class="card bpr-review stack dtm-review" id="0825_1000202069_#####"
    card_re = re.compile(
        r'class="card bpr-review stack dtm-review"\s+id="([^"]+)"(.*?)(?=class="card bpr-review stack dtm-review"|aria-label="pagination"|$)',
        re.I | re.S,
    )
    for m in card_re.finditer(html):
        review_id = m.group(1).strip()
        body_html = m.group(2)

        # Reviewer name
        name_m = re.search(
            r'bpr-review-title[^>]*>.*?<span[^>]*>\s*<span[^>]*>Review from</span>\s*([^<]+)',
            body_html,
            re.I | re.S,
        )
        if not name_m:
            name_m = re.search(r'Review from</span>\s*([^<]+)', body_html, re.I)
        author = (name_m.group(1).strip() if name_m else "Anonymous")

        # Date
        date_m = re.search(
            r"Date:</strong>\s*(?:<!--\s*-->\s*)?(\d{1,2}/\d{1,2}/\d{2,4})",
            body_html,
            re.I,
        )
        date_raw = date_m.group(1) if date_m else ""
        created_at = parse_date(date_raw) or datetime.now(timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )

        # Rating = count of filled stars
        filled = len(re.findall(r'data-filled=""', body_html))
        if filled == 0:
            stars_m = re.search(r"(\d)\s*stars?", body_html, re.I)
            filled = int(stars_m.group(1)) if stars_m else 0
        rating = float(filled) if filled > 0 else None

        # Plain text body
        text = re.sub(r"<script[\s\S]*?</script>", " ", body_html, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
        text = re.sub(r"<svg[\s\S]*?</svg>", " ", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()

        # Drop UI chrome prefixes
        text = re.sub(r"^>?\s*", "", text)
        text = re.sub(r"^id=\"[^\"]+\"\s*", "", text)
        text = re.sub(
            r"^Review from\s+.+?Date:\s*\d{1,2}/\d{1,2}/\d{2,4}\s*",
            "",
            text,
            count=1,
            flags=re.I,
        )
        text = re.sub(r"^\d\s*stars?\s*", "", text, flags=re.I)
        # Common BBB footer noise after the free-text body
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
                "url": f"{BASE_URL}#{review_id}",
                "source": "BBB",
                "company": "Likewize",
            }
        )
    return reviews


def detect_max_page(html: str) -> int:
    pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", html)]
    return max(pages) if pages else 1


def scrape(max_pages: int = 80, delay: float = 1.1) -> Dict[str, Any]:
    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "darwin", "mobile": False}
    )
    by_id: Dict[str, Dict[str, Any]] = {}
    max_page = 1
    pages_fetched = 0
    errors: List[str] = []

    # Page 1
    try:
        r = scraper.get(BASE_URL, timeout=45)
        r.raise_for_status()
        html = r.text
        max_page = min(detect_max_page(html), max_pages)
        for rev in extract_reviews(html):
            by_id[rev["id"]] = rev
        pages_fetched = 1
        print(f"[BBB] Page 1/{max_page}: +{len(extract_reviews(html))} ({len(by_id)} total)", file=sys.stderr)
    except Exception as e:
        return {"error": f"Page 1 failed: {e}", "reviews": [], "pages": 0}

    for page in range(2, max_page + 1):
        time.sleep(delay)
        url = f"{BASE_URL}?page={page}"
        try:
            r = scraper.get(url, timeout=45)
            if r.status_code != 200:
                errors.append(f"page {page}: HTTP {r.status_code}")
                continue
            revs = extract_reviews(r.text)
            before = len(by_id)
            for rev in revs:
                by_id[rev["id"]] = rev
            pages_fetched += 1
            print(
                f"[BBB] Page {page}/{max_page}: +{len(by_id) - before} new from {len(revs)} "
                f"({len(by_id)} total)",
                file=sys.stderr,
            )
            if len(revs) == 0:
                # empty page — stop early
                print(f"[BBB] Empty page {page}, stopping.", file=sys.stderr)
                break
        except Exception as e:
            errors.append(f"page {page}: {e}")
            print(f"[BBB] Page {page} failed: {e}", file=sys.stderr)

    return {
        "reviews": list(by_id.values()),
        "pages": pages_fetched,
        "max_page_detected": max_page,
        "errors": errors,
        "source_url": BASE_URL,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-pages", type=int, default=80)
    parser.add_argument("--delay", type=float, default=1.1)
    args = parser.parse_args()
    result = scrape(max_pages=args.max_pages, delay=args.delay)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
