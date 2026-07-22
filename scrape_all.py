#!/usr/bin/env python3
"""
scrape_all.py — download the ENTIRE Hypixel SkyBlock wiki into one corpus file.

Run this ONCE on any machine with normal internet + Python 3. It walks every
article on hypixel-skyblock.fandom.com through the official MediaWiki API, strips the wiki
markup down to clean plain text, and writes:

    wiki_corpus.json     {"pages": {"Arthur": "clean text...", ...}}

The backend (site/api/chat.js) loads this file and instantly retrieves the most
relevant pages for each question — so the AI answers from the real wiki with no
per-request web calls, no CORS proxy, and no hand-fed facts.

  * Covers ALL ~15k article pages (main namespace + the NPC/Mob data templates
    that hold coordinates).
  * Resumable: re-run it any time; it skips pages it already has unless you pass
    --refresh. Safe to Ctrl-C — progress is saved every batch.
  * No API key, no account. Just: python scrape_all.py

Usage:
    pip install requests
    python scrape_all.py                 # full scrape (resumes if interrupted)
    python scrape_all.py --refresh       # re-download everything from scratch
    python scrape_all.py --limit 500     # quick test on the first 500 pages
"""
import argparse
import json
import os
import re
import sys
import time

import requests

API = "https://hypixel-skyblock.fandom.com/api.php"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wiki_corpus.json")
UA = "Skyblockopedia-scraper/1.0 (educational; contact via app)"
# Namespaces worth pulling: 0 = articles, 10 = Template (holds NPC/<id> coord data).
NAMESPACES = [0, 10]
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA})


# ---------------------------------------------------------------------------
# wikitext -> plain text
# ---------------------------------------------------------------------------
def clean(text):
    if not text:
        return ""
    t = text
    t = re.sub(r"<!--.*?-->", " ", t, flags=re.S)          # comments
    t = re.sub(r"<ref[^>]*>.*?</ref>", " ", t, flags=re.S)  # references
    t = re.sub(r"<ref[^>]*/>", " ", t)
    t = re.sub(r"<[^>]+>", " ", t)                          # other html tags
    # Keep the data inside common stat templates, e.g. {{Health|1,000}} -> "Health 1,000"
    def tmpl(m):
        body = m.group(1)
        parts = [p.strip() for p in body.split("|")]
        if not parts:
            return " "
        head = parts[0].split("=")[-1].strip()
        vals = []
        for p in parts[1:]:
            v = p.split("=")[-1].strip() if "=" in p else p
            if v and not v.lower().startswith(("image", "file:", "align", "width", "style")):
                vals.append(v)
        return " " + " ".join([head] + vals) + " "
    for _ in range(6):  # resolve nested templates a few layers deep
        new = re.sub(r"\{\{([^{}]*)\}\}", tmpl, t)
        if new == t:
            break
        t = new
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]", r"\1", t)  # [[a|b]] -> b
    t = re.sub(r"\[\[([^\]]+)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+\s+([^\]]+)\]", r"\1", t)      # [url label] -> label
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub(r"'''''|'''|''", "", t)                       # bold/italic
    t = re.sub(r"^[=]{2,}\s*(.*?)\s*[=]{2,}$", r"\1:", t, flags=re.M)  # headings
    t = re.sub(r"^[\*#:;]+\s*", "", t, flags=re.M)           # list markers
    t = t.replace("{|", " ").replace("|}", " ").replace("|-", " ")
    t = re.sub(r"^\s*[!|]\s*", "", t, flags=re.M)            # table cells
    t = re.sub(r"&nbsp;", " ", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


# ---------------------------------------------------------------------------
# MediaWiki API
# ---------------------------------------------------------------------------
def api(params, tries=5):
    params = {**params, "format": "json", "formatversion": "2"}
    for attempt in range(tries):
        try:
            r = SESSION.get(API, params=params, timeout=60)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            wait = 2 * (attempt + 1)
            print(f"  ! {e} — retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("API failed after retries: " + str(params))


def all_titles(ns, limit=None):
    """Yield every non-redirect page title in a namespace."""
    cont = {}
    got = 0
    while True:
        d = api({"action": "query", "list": "allpages", "apnamespace": ns,
                 "apfilterredir": "nonredirects", "aplimit": "500", **cont})
        for p in d.get("query", {}).get("allpages", []):
            yield p["title"]
            got += 1
            if limit and got >= limit:
                return
        if "continue" in d:
            cont = d["continue"]
        else:
            return


def fetch_contents(titles):
    """Return {title: wikitext} for up to 50 titles in one call."""
    d = api({"action": "query", "prop": "revisions", "rvprop": "content",
             "rvslots": "main", "titles": "|".join(titles), "redirects": "1"})
    out = {}
    for p in d.get("query", {}).get("pages", []):
        revs = p.get("revisions") or []
        if not revs:
            continue
        slot = revs[0].get("slots", {}).get("main", {})
        content = slot.get("content") or revs[0].get("content") or ""
        out[p["title"]] = content
    return out


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download every page")
    ap.add_argument("--limit", type=int, default=None, help="cap pages per namespace (for testing)")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    pages = {}
    if os.path.exists(OUT) and not args.refresh:
        try:
            pages = json.load(open(OUT, encoding="utf-8")).get("pages", {})
            print(f"Resuming — {len(pages)} pages already saved.")
        except Exception:
            pages = {}

    print("Enumerating every page title...")
    titles = []
    for ns in NAMESPACES:
        ns_titles = list(all_titles(ns, args.limit))
        print(f"  namespace {ns}: {len(ns_titles)} pages")
        titles += ns_titles
    todo = [t for t in titles if t not in pages]
    print(f"{len(titles)} total pages, {len(todo)} to fetch.\n")

    done = 0
    for batch in chunks(todo, 50):
        try:
            for title, raw in fetch_contents(batch).items():
                pages[title] = clean(raw)[:20000]  # cap per page to keep file sane
        except Exception as e:
            print(f"  ! batch failed ({e}); continuing", file=sys.stderr)
        done += len(batch)
        if done % 500 < 50:  # save & report roughly every 500 pages
            json.dump({"pages": pages}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
            print(f"  {done}/{len(todo)} fetched — saved ({len(pages)} total)")
        time.sleep(0.1)  # be polite to the wiki

    json.dump({"pages": pages}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    mb = os.path.getsize(OUT) / 1e6
    print(f"\nDone. {len(pages)} pages -> {OUT} ({mb:.1f} MB)")
    print("Now deploy (or restart) the backend; it will serve answers from this corpus.")


if __name__ == "__main__":
    main()
