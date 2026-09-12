#!/usr/bin/env python3
"""
Recipe Code & API Endpoint Scraper
==================================
Scrapes recipe_code + API endpoints from AI workflow platforms
(roboneo.com, framia.ai, weavy.ai, weave.figma.com, etc.)

Usage:
  python scraper.py <url>                          # scrape single URL
  python scraper.py <domain> --all-pages           # scrape all configured pages
  python scraper.py <domain> --category video_models  # scrape specific category
  python scraper.py <domain> --js-bundles          # also fetch JS bundles
  python scraper.py --list                         # list configured sites
  python scraper.py --list-categories roboneo.com  # list categories for a site
  python scraper.py <url> --output result.json
"""

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from typing import Optional
from urllib.parse import urljoin, urlparse

try:
    import requests
except ImportError:
    print("[!] requests not found. Install: pip install requests beautifulsoup4")
    sys.exit(1)

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("[!] beautifulsoup4 not found. Install: pip install requests beautifulsoup4")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "sites.json")
DEFAULT_TIMEOUT = 30
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


@dataclass
class Recipe:
    code: str
    url: str
    source: str  # "html", "js", "link"


@dataclass
class Endpoint:
    url: str
    method: str  # "GET", "POST", "UNKNOWN"
    source: str  # "html", "js", "inline", "known"
    context: str = ""


@dataclass
class ModelInfo:
    name: str
    slug: str
    url: str
    category: str
    status: str = ""  # "scraped", "pending", "error"
    description: str = ""
    features: list[str] = field(default_factory=list)
    endpoints: list[Endpoint] = field(default_factory=list)


@dataclass
class ScrapeResult:
    domain: str
    site_name: str
    url: str
    status: int
    recipes: list[Recipe] = field(default_factory=list)
    endpoints: list[Endpoint] = field(default_factory=list)
    models: list[ModelInfo] = field(default_factory=list)
    js_bundles_found: list[str] = field(default_factory=list)
    error: str = ""


class RecipeEndpointScraper:
    def __init__(self, config_path: str = CONFIG_PATH):
        with open(config_path, "r", encoding="utf-8") as f:
            self.sites = json.load(f)
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})

    # ─── config helpers ────────────────────────────────────────────

    def _resolve_site(self, target: str) -> tuple[str, dict]:
        domain = self._extract_domain(target)
        if domain in self.sites:
            return domain, self.sites[domain]
        for key, cfg in self.sites.items():
            if key in target or target in key:
                return key, cfg
        raise ValueError(
            f"Site '{target}' not configured. Available: {list(self.sites.keys())}"
        )

    @staticmethod
    def _extract_domain(url: str) -> str:
        if "://" not in url:
            return url.lower().strip("/")
        return urlparse(url).netloc.lower()

    # ─── fetch ─────────────────────────────────────────────────────

    def _fetch(self, url: str, extra_headers: dict | None = None) -> tuple[str, int, str]:
        headers = {}
        if extra_headers:
            headers.update(extra_headers)
        try:
            r = self.session.get(url, headers=headers, timeout=DEFAULT_TIMEOUT)
            return r.text, r.status_code, ""
        except requests.RequestException as e:
            return "", 0, str(e)

    # ─── extractors ────────────────────────────────────────────────

    def _extract_recipes(
        self, html: str, base_url: str, patterns: list[str]
    ) -> list[Recipe]:
        seen = set()
        recipes: list[Recipe] = []
        soup = BeautifulSoup(html, "html.parser")

        for a in soup.find_all("a", href=True):
            href = a["href"]
            full = urljoin(base_url, href)
            for pattern in patterns:
                m = re.search(pattern, full)
                if m and m.group(1) not in seen:
                    seen.add(m.group(1))
                    recipes.append(Recipe(code=m.group(1), url=full, source="html"))

        for script in soup.find_all("script"):
            if script.string:
                for pattern in patterns:
                    for m in re.finditer(pattern, script.string):
                        code = m.group(1)
                        if code not in seen:
                            seen.add(code)
                            recipes.append(Recipe(code=code, url="", source="js"))

        return recipes

    def _extract_endpoints(
        self,
        html: str,
        base_url: str,
        patterns: list[str],
        known: list[str],
        js_texts: list[str] | None = None,
    ) -> list[Endpoint]:
        seen = set()
        endpoints: list[Endpoint] = []

        for ep in known:
            if ep not in seen:
                seen.add(ep)
                endpoints.append(Endpoint(url=ep, method="UNKNOWN", source="known"))

        soup = BeautifulSoup(html, "html.parser")
        texts_to_search = [html]

        for script in soup.find_all("script"):
            if script.string:
                texts_to_search.append(script.string)

        if js_texts:
            texts_to_search.extend(js_texts)

        for text in texts_to_search:
            for pattern in patterns:
                for m in re.finditer(pattern, text):
                    url = m.group(0) if not m.groups() else m.group(1)
                    if url and url not in seen:
                        seen.add(url)
                        method = self._guess_method(text, url)
                        endpoints.append(Endpoint(url=url, method=method, source="js"))

        fetch_patterns = [
            r'fetch\s*\(\s*["\']([^"\']+)["\']',
            r'axios\.(?:get|post|put|delete|patch)\s*\(\s*["\']([^"\']+)["\']',
            r'\.get\s*\(\s*["\']([^"\']+)["\']',
            r'\.post\s*\(\s*["\']([^"\']+)["\']',
            r'(?:url|href|src|action)\s*[:=]\s*["\']([^"\']+(?:api|gateway|sync|request)[^"\']*)["\']',
            r'baseURL\s*[:=]\s*["\']([^"\']+)["\']',
            r'API_URL\s*[:=]\s*["\']([^"\']+)["\']',
            r'apiUrl\s*[:=]\s*["\']([^"\']+)["\']',
        ]

        for text in texts_to_search:
            for fp in fetch_patterns:
                for m in re.finditer(fp, text, re.IGNORECASE):
                    url = m.group(1)
                    if url not in seen and not url.startswith("#") and not url.startswith("data:"):
                        seen.add(url)
                        method = self._guess_method_from_fetch(fp, text, m)
                        endpoints.append(Endpoint(url=url, method=method, source="inline"))

        return endpoints

    def _extract_model_info(self, html: str, base_url: str, model_name: str, category: str) -> ModelInfo:
        soup = BeautifulSoup(html, "html.parser")
        slug = model_name.lower().replace(" ", "-").replace(".", "")

        description = ""
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc and meta_desc.get("content"):
            description = meta_desc["content"][:200]

        if not description:
            og_desc = soup.find("meta", attrs={"property": "og:description"})
            if og_desc and og_desc.get("content"):
                description = og_desc["content"][:200]

        features = []
        for h2 in soup.find_all(["h2", "h3"]):
            text = h2.get_text(strip=True)
            if text and len(text) > 5 and len(text) < 100:
                features.append(text)

        return ModelInfo(
            name=model_name,
            slug=slug,
            url=base_url,
            category=category,
            status="scraped",
            description=description,
            features=features[:10],
        )

    @staticmethod
    def _guess_method(text: str, url: str) -> str:
        if "post" in text.lower() or "POST" in text:
            return "POST"
        if "get" in text.lower() or "GET" in text:
            return "GET"
        return "UNKNOWN"

    @staticmethod
    def _guess_method_from_fetch(pattern: str, text: str, match: re.Match) -> str:
        if "post" in pattern.lower():
            return "POST"
        if "get" in pattern.lower():
            return "GET"
        if "post" in text.lower():
            return "POST"
        return "GET"

    def _find_js_bundles(self, html: str, base_url: str, search_terms: list[str]) -> list[str]:
        soup = BeautifulSoup(html, "html.parser")
        bundles: list[str] = []
        for script in soup.find_all("script", src=True):
            src = script["src"]
            full = urljoin(base_url, src)
            for term in search_terms:
                if term in src:
                    bundles.append(full)
                    break
        return bundles

    def _fetch_js_bundles(self, bundle_urls: list[str], quiet: bool = False) -> list[str]:
        texts: list[str] = []
        for url in bundle_urls[:5]:
            if not quiet:
                print(f"  [*] Fetching JS bundle: {url[:80]}...")
            content, status, err = self._fetch(url)
            if status == 200 and content:
                texts.append(content)
            elif not quiet:
                print(f"  [!] Failed: {err or status}")
        return texts

    def _filter_asset_urls(self, endpoints: list[Endpoint]) -> list[Endpoint]:
        asset_exts = (".avif", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".css")
        api_keywords = ("api", "gateway", "sync", "auth", "login", "signin", "token", "upload", "request", "graphql", "rest", "v1/", "v2/", "v3/")
        filtered = []
        for ep in endpoints:
            url_lower = ep.url.lower()
            url_no_qs = url_lower.split("?")[0]
            if any(url_no_qs.endswith(ext) for ext in asset_exts):
                continue
            if url_no_qs.endswith(".js") and any(s in url_lower for s in (
                "cdn.", "webflow.", "jsdelivr", "cdnjs", "unpkg", "googletagmanager",
                "google-analytics", "facebook", "fbevents", "gstatic",
                "/chunks/", "/vendor-", "polyfills", "webpack", "framework",
                "_buildmanifest", "_ssgmanifest", "finsweetcomponents",
                "gsap", "lottie", "jquery", "bootstrap",
            )):
                continue
            if url_no_qs.endswith(".json") and "lottie" in url_lower:
                continue
            filtered.append(ep)
        def sort_key(e: Endpoint):
            is_api = any(kw in e.url.lower() for kw in api_keywords)
            return (0 if is_api else 1, e.url)
        filtered.sort(key=sort_key)
        return filtered

    # ─── main scrape ───────────────────────────────────────────────

    def scrape(self, target: str, all_pages: bool = False, fetch_js: bool = False,
               quiet: bool = False, category: str = None) -> list[ScrapeResult]:
        domain, config = self._resolve_site(target)
        base_url = config["base_url"]
        results: list[ScrapeResult] = []

        extra_headers = config.get("extra_headers", {})
        recipe_patterns = config.get("recipe_patterns", [])
        endpoint_patterns = config.get("endpoint_patterns", [])
        known_endpoints = config.get("known_endpoints", [])
        js_search = config.get("js_bundle_search", [])

        # Determine pages to scrape
        if category and "categories" in config:
            cat_info = config["categories"].get(category)
            if not cat_info:
                available = list(config["categories"].keys())
                raise ValueError(f"Category '{category}' not found. Available: {available}")
            pages = list(cat_info["pages"].values())
            if not quiet:
                print(f"\n[*] Category: {cat_info['label']} ({len(pages)} pages)")
        elif all_pages:
            pages = config.get("page_paths", ["/"])
        else:
            pages = ["/"]
            if "://" in target:
                pages = [urlparse(target).path or "/"]

        for path in pages:
            url = urljoin(base_url, path) if path.startswith("/") else path
            if not quiet:
                print(f"\n{'='*60}")
                print(f"[*] Scraping: {url}")

            html, status, err = self._fetch(url, extra_headers)
            if err:
                if not quiet:
                    print(f"  [!] Error: {err}")
                results.append(
                    ScrapeResult(domain=domain, site_name=config["name"], url=url, status=0, error=err)
                )
                continue

            if not quiet:
                print(f"  [+] Status: {status}  |  Size: {len(html)} bytes")

            result = ScrapeResult(domain=domain, site_name=config["name"], url=url, status=status)

            # Extract model info if category-based
            if category and "categories" in config:
                cat_info = config["categories"][category]
                for model_name, model_path in cat_info["pages"].items():
                    if model_path == path:
                        model_info = self._extract_model_info(html, url, model_name, category)
                        model_info.endpoints = self._extract_endpoints(
                            html, base_url, endpoint_patterns, known_endpoints
                        )
                        model_info.endpoints = self._filter_asset_urls(model_info.endpoints)
                        result.models.append(model_info)
                        break

            if recipe_patterns:
                result.recipes = self._extract_recipes(html, base_url, recipe_patterns)
                if not quiet:
                    print(f"  [+] Recipes found: {len(result.recipes)}")

            js_texts: list[str] = []
            if fetch_js and js_search:
                result.js_bundles_found = self._find_js_bundles(html, base_url, js_search)
                if not quiet:
                    print(f"  [+] JS bundles found: {len(result.js_bundles_found)}")
                js_texts = self._fetch_js_bundles(result.js_bundles_found, quiet)

            result.endpoints = self._extract_endpoints(
                html, base_url, endpoint_patterns, known_endpoints, js_texts
            )
            result.endpoints = self._filter_asset_urls(result.endpoints)
            if not quiet:
                print(f"  [+] Endpoints found: {len(result.endpoints)}")

            results.append(result)

        return results

    # ─── output ────────────────────────────────────────────────────

    def print_results(self, results: list[ScrapeResult]):
        for r in results:
            print(f"\n{'─'*60}")
            print(f"Site : {r.site_name} ({r.domain})")
            print(f"URL  : {r.url}")
            print(f"Status: {r.status}")
            if r.error:
                print(f"Error: {r.error}")
                continue

            if r.models:
                for m in r.models:
                    print(f"\n  [M] Model: {m.name}")
                    print(f"    Category : {m.category}")
                    print(f"    URL      : {m.url}")
                    if m.description:
                        print(f"    Desc     : {m.description[:100]}...")
                    if m.features:
                        print(f"    Features : {', '.join(m.features[:5])}")
                    if m.endpoints:
                        print(f"    Endpoints:")
                        for ep in m.endpoints:
                            print(f"      [{ep.method:7s}] {ep.url}")

            if r.recipes:
                print(f"\n  [R] Recipes ({len(r.recipes)}):")
                for recipe in r.recipes:
                    print(f"    code={recipe.code}  url={recipe.url}  src={recipe.source}")

            if r.endpoints:
                print(f"\n  [E] Endpoints ({len(r.endpoints)}):")
                for ep in r.endpoints:
                    print(f"    [{ep.method:7s}] {ep.url}")

            if r.js_bundles_found:
                print(f"\n  [JS] Bundles ({len(r.js_bundles_found)}):")
                for b in r.js_bundles_found:
                    print(f"    {b}")

    def to_json(self, results: list[ScrapeResult]) -> str:
        output = []
        for r in results:
            d = {
                "domain": r.domain,
                "site_name": r.site_name,
                "url": r.url,
                "status": r.status,
                "error": r.error,
                "recipes": [asdict(rc) for rc in r.recipes],
                "endpoints": [asdict(ep) for ep in r.endpoints],
                "models": [asdict(m) for m in r.models],
                "js_bundles_found": r.js_bundles_found,
            }
            output.append(d)
        return json.dumps(output, indent=2, ensure_ascii=False)

    def list_sites(self):
        print("Configured sites:")
        for domain, cfg in self.sites.items():
            print(f"  {domain:25s} -> {cfg['name']}")
            print(f"    Base URL     : {cfg['base_url']}")
            print(f"    Recipe pats  : {len(cfg.get('recipe_patterns', []))}")
            print(f"    Endpoint pats: {len(cfg.get('endpoint_patterns', []))}")
            print(f"    Known eps    : {len(cfg.get('known_endpoints', []))}")
            if "categories" in cfg:
                print(f"    Categories   : {', '.join(cfg['categories'].keys())}")
            print()

    def list_categories(self, target: str):
        domain, config = self._resolve_site(target)
        if "categories" not in config:
            print(f"Site '{config['name']}' has no categories configured.")
            return
        print(f"Categories for {config['name']}:")
        for cat_key, cat_info in config["categories"].items():
            print(f"\n  {cat_key} ({cat_info['label']}):")
            for model_name, model_path in cat_info["pages"].items():
                print(f"    {model_name:30s} -> {model_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Recipe Code & API Endpoint Scraper",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scraper.py roboneo.com
  python scraper.py roboneo.com --category video_models
  python scraper.py roboneo.com --category image_models
  python scraper.py roboneo.com --all-pages
  python scraper.py weavy.ai --js-bundles
  python scraper.py --list
  python scraper.py --list-categories roboneo.com
        """,
    )
    parser.add_argument("target", nargs="?", help="URL or domain to scrape")
    parser.add_argument("--all-pages", "-a", action="store_true", help="Scrape all configured page paths")
    parser.add_argument("--category", "-c", help="Scrape specific category (e.g. video_models, image_models)")
    parser.add_argument("--js-bundles", "-j", action="store_true", help="Fetch and analyze JS bundles")
    parser.add_argument("--output", "-o", help="Save results to JSON file")
    parser.add_argument("--list", "-l", action="store_true", help="List configured sites")
    parser.add_argument("--list-categories", action="store_true", help="List categories for target site")
    parser.add_argument("--quiet", "-q", action="store_true", help="JSON-only output (no logs)")

    args = parser.parse_args()

    scraper = RecipeEndpointScraper()

    if args.list:
        scraper.list_sites()
        return

    if args.list_categories:
        if not args.target:
            print("Error: --list-categories requires a target site")
            return
        scraper.list_categories(args.target)
        return

    if not args.target:
        parser.print_help()
        return

    results = scraper.scrape(
        args.target,
        all_pages=args.all_pages,
        fetch_js=args.js_bundles,
        quiet=args.quiet,
        category=args.category,
    )

    if args.quiet:
        print(scraper.to_json(results))
    else:
        scraper.print_results(results)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(scraper.to_json(results))
        print(f"\n[+] Saved to {args.output}")


if __name__ == "__main__":
    main()