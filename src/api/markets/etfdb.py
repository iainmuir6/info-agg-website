# etfdb.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: 2026-03-10
# Description: Scrapes ETF metadata and holdings from etfdb.com using Selenium.
#
#   Per ticker — two URL visits in one browser session:
#     1. https://etfdb.com/etf/{TICKER}/#etf-ticker-profile  → fund name, category, AUM, etc.
#     2. https://etfdb.com/etf/{TICKER}/#holdings            → holdings table (lazy-loaded tab)
#
#   scrape_all_etfs() drives a single Chrome session across all tickers,
#   collects [{ticker, info, holdings}] for all ETFs, then returns them
#   for batch upsert by sync_etfdb_data() in markets_db_helper.
#
#   Trigger: manual only via --scrape-etf-info (never daily/seed).

from typing import Dict, List, Optional, Any
from datetime import date, datetime
import os
import sys
import time

_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)
from etl_lib import et_today

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None  # type: ignore

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from webdriver_manager.chrome import ChromeDriverManager
    _SELENIUM_AVAILABLE = True
except ImportError:
    _SELENIUM_AVAILABLE = False

_ETFDB_BASE = "https://etfdb.com/etf"
_CF_WAIT       = 30   # seconds to wait for Cloudflare JS challenge to clear
_HOLDINGS_WAIT = 15   # seconds to wait for holdings table after tab switch
_TAB_SETTLE    = 2    # seconds after tab navigation before parsing
_INTER_ETF_DELAY = 8  # seconds between ETF sessions (politeness / CF cool-down)

_USER_AGENT = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/120.0.0.0 Safari/537.36'
)


# ---------------------------------------------------------------------------
# Browser setup
# ---------------------------------------------------------------------------

def _make_driver(headless: bool = True) -> "webdriver.Chrome":
    """Create a Chrome WebDriver with anti-detection options."""
    options = Options()
    if headless:
        options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-blink-features=AutomationControlled')
    options.add_experimental_option('excludeSwitches', ['enable-automation'])
    options.add_experimental_option('useAutomationExtension', False)
    options.add_argument(f'--user-agent={_USER_AGENT}')
    options.add_argument('--window-size=1920,1080')
    options.add_argument('--lang=en-US')

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)

    # Mask navigator.webdriver to reduce bot-detection triggers
    driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
        'source': 'Object.defineProperty(navigator, "webdriver", {get: () => undefined})'
    })

    return driver


def _wait_for_content(driver: "webdriver.Chrome") -> bool:
    """
    Wait for the Cloudflare JS challenge to clear, then for the real page content.

    Cloudflare IUAM sets the page title to "Just a moment..." while the JS
    challenge runs (~5 s).  A real Chrome session passes automatically.
    Returns True if the real page loaded; False if still on challenge after timeout.
    """
    try:
        # Phase 1: wait until title is no longer the CF challenge
        WebDriverWait(driver, _CF_WAIT).until(
            lambda d: 'just a moment' not in d.title.lower()
        )
    except Exception:
        print(f"    [warn] Cloudflare challenge did not resolve within {_CF_WAIT}s")
        return False

    try:
        # Phase 2: wait for real page content
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'table#etf-holdings'))
        )
    except Exception:
        pass  # page loaded but holdings table may not exist; parser handles it

    return True


def _navigate_to_holdings(driver: "webdriver.Chrome", base_url: str) -> None:
    """
    Navigate to the #holdings tab.  Since etfdb is a hash-based SPA, navigating
    to #holdings on the same URL fires a hashchange without a full reload.
    Also clicks the tab link directly to ensure the tab is active.
    """
    driver.get(base_url + '#holdings')
    time.sleep(_TAB_SETTLE)
    try:
        tab_link = driver.find_element(By.CSS_SELECTOR, 'a[href="#holdings"]')
        driver.execute_script("arguments[0].click();", tab_link)
        time.sleep(_TAB_SETTLE)
    except Exception:
        pass


def _wait_for_holdings(driver: "webdriver.Chrome") -> None:
    """Wait for the holdings table (already in DOM from page load) to be present."""
    try:
        WebDriverWait(driver, _HOLDINGS_WAIT).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'table#etf-holdings'))
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Per-page parsing
# ---------------------------------------------------------------------------

def _parse_info(soup: "BeautifulSoup", ticker: str) -> Optional[Dict[str, Any]]:
    """
    Extract all available ETF metadata from the profile page.

    Two extraction passes to avoid key collisions:
      table_kv  — <tr>/<dl>: FactSet Classifications + stats
      divrow_kv — <div class="row"> spans: Vitals + ETF Database Themes
    """
    try:
        # --- Fund name ---
        name = None
        h1 = soup.find('h1')
        if h1:
            name = h1.get_text(strip=True)
            if f'({ticker.upper()})' in name:
                name = name.replace(f'({ticker.upper()})', '').strip()
            elif name.upper().startswith(ticker.upper()):
                name = name[len(ticker):].strip()

        if not name:
            og = soup.find('meta', property='og:title')
            if og:
                raw = (og.get('content', '') or '')
                raw = raw.replace(f'({ticker.upper()})', '').strip()
                if raw.upper().startswith(ticker.upper()):
                    raw = raw[len(ticker):].strip()
                name = raw or None

        if not name:
            return None

        table_kv  = _extract_kv(soup)
        divrow_kv = _extract_divrow_kv(soup)

        # ── Vitals (div.row) ──────────────────────────────────────────────────
        issuer          = divrow_kv.get('issuer') or divrow_kv.get('brand')
        brand           = divrow_kv.get('brand')
        structure       = divrow_kv.get('structure')
        expense_ratio   = divrow_kv.get('expense ratio')
        index_tracked   = divrow_kv.get('index tracked')
        etfdb_category  = divrow_kv.get('category')         # "Large Cap Growth Equities"
        inception_date  = _try_parse_date(divrow_kv.get('inception'))

        # ── ETF Database Themes (div.row) ─────────────────────────────────────
        asset_class       = divrow_kv.get('asset class')
        asset_class_size  = divrow_kv.get('asset class size')
        asset_class_style = divrow_kv.get('asset class style')
        region_general    = divrow_kv.get('region (general)')
        region_specific   = divrow_kv.get('region (specific)')

        # ── FactSet Classifications (table rows) ──────────────────────────────
        factset_segment   = table_kv.get('segment')         # "Equity: U.S. - Total Market"
        factset_category  = table_kv.get('category')        # "Size and Style"
        factset_focus     = table_kv.get('focus')
        factset_niche     = table_kv.get('niche')
        factset_strategy  = table_kv.get('strategy')
        factset_weighting = table_kv.get('weighting scheme')

        # ── Stats (table rows) ────────────────────────────────────────────────
        num_holdings     = table_kv.get('number of holdings')
        aum              = table_kv.get('net assets') or table_kv.get('total assets') or table_kv.get('aum')
        annual_div_yield = table_kv.get('annual dividend yield')
        annual_div_rate  = table_kv.get('annual dividend rate')
        ytd_return       = table_kv.get('ytd return')
        one_yr_return    = table_kv.get('1 year return')
        beta             = table_kv.get('beta')

        # ── DB industry field ─────────────────────────────────────────────────
        industry = etfdb_category or factset_segment

        return {
            'ticker': ticker,
            'name': name,
            # --- Stored in stocks table ---
            'industry': industry,
            'ipo_date': inception_date,
            'country': None,    # Finnhub provides during daily profile sync
            'currency': None,
            'exchange': None,
            'logo': None,
            'website': None,
            'market_cap': None,
            'share_outstanding': None,
            # --- Vitals ---
            'issuer': issuer,
            'brand': brand,
            'structure': structure,
            'expense_ratio': expense_ratio,
            'index_tracked': index_tracked,
            'etfdb_category': etfdb_category,
            # --- ETF Database Themes ---
            'asset_class': asset_class,
            'asset_class_size': asset_class_size,
            'asset_class_style': asset_class_style,
            'region_general': region_general,
            'region_specific': region_specific,
            # --- FactSet Classifications ---
            'factset_segment': factset_segment,
            'factset_category': factset_category,
            'factset_focus': factset_focus,
            'factset_niche': factset_niche,
            'factset_strategy': factset_strategy,
            'factset_weighting': factset_weighting,
            # --- Stats ---
            'num_holdings': num_holdings,
            'aum': aum,
            'annual_div_yield': annual_div_yield,
            'annual_div_rate': annual_div_rate,
            'ytd_return': ytd_return,
            'one_yr_return': one_yr_return,
            'beta': beta,
        }

    except Exception as e:
        print(f"  [etfdb] Info parse error for {ticker}: {e}")
        return None


def _parse_holdings(soup: "BeautifulSoup", ticker: str, top_n: int = 15) -> List[Dict[str, Any]]:
    """
    Extract the top-N holdings from the holdings tab page source.
    Searches the #holdings section first, then falls back to any table with
    symbol/weight headers.
    """
    try:
        # Determine as_of_date
        as_of_date = et_today().isoformat()
        for key, val in _extract_kv(soup).items():
            if 'holdings date' in key or ('as of' in key and 'date' in key):
                parsed = _try_parse_date(val)
                if parsed:
                    as_of_date = parsed
                    break

        # Locate the holdings table.
        # etfdb renders <table id="etf-holdings"> — the table element itself has
        # the id, so we use it directly rather than searching for a nested table.
        holdings_table = None

        # Primary: table#etf-holdings (the main per-holding rows table)
        el = soup.find(id='etf-holdings')
        if el and el.name == 'table':
            holdings_table = el
        elif el:
            holdings_table = el.find('table')

        # Fallback: any <table> whose headers mention symbol/holding/asset
        if holdings_table is None:
            for table in soup.find_all('table'):
                header_text = ' '.join(
                    (th.get_text(strip=True) or '').lower()
                    for th in table.find_all('th')
                )
                if 'symbol' in header_text and ('holding' in header_text or 'asset' in header_text):
                    holdings_table = table
                    break

        if holdings_table is None:
            print(f"  [etfdb] Holdings table not found for {ticker}")
            return []

        # Map column indices from header row.
        # etfdb headers have doubled text from sort widgets, e.g. "SymbolSymbol",
        # "HoldingHolding", "% Assets% Assets" — .lower() + substring match handles this.
        headers = [(th.get_text(strip=True) or '').lower() for th in holdings_table.find_all('th')]
        col: Dict[str, int] = {}
        for i, h in enumerate(headers):
            if ('symbol' in h or 'ticker' in h) and 'symbol' not in col:
                col['symbol'] = i
            elif ('holding' in h or 'name' in h or 'description' in h) and 'name' not in col:
                col['name'] = i
            elif ('weight' in h or 'asset' in h or '%' in h) and 'weight' not in col:
                col['weight'] = i
            elif 'share' in h and 'shares' not in col:
                col['shares'] = i
            elif ('value' in h or 'market' in h) and 'market_value' not in col:
                col['market_value'] = i

        data_rows = [r for r in holdings_table.find_all('tr') if r.find('td')]
        holdings: List[Dict[str, Any]] = []

        for row in data_rows[:top_n]:
            cells = row.find_all('td')

            def cell(name: str) -> Optional[str]:
                idx = col.get(name)
                if idx is None or idx >= len(cells):
                    return None
                return cells[idx].get_text(strip=True) or None

            symbol = cell('symbol') or (cells[0].get_text(strip=True) if cells else None)
            if not symbol:
                continue

            holdings.append({
                'asset_symbol': symbol.strip().upper(),
                'asset_name': cell('name'),
                'weight_percentage': _parse_float(cell('weight')),
                'shares': _parse_int(cell('shares')),
                'market_value': _parse_float(cell('market_value')),
                'as_of_date': as_of_date,
            })

        return holdings

    except Exception as e:
        print(f"  [etfdb] Holdings parse error for {ticker}: {e}")
        return []


# ---------------------------------------------------------------------------
# Main public API
# ---------------------------------------------------------------------------

def _scrape_one_etf(ticker: str, headless: bool = True) -> Dict[str, Any]:
    """
    Scrape a single ETF in its own isolated browser session.

    Uses a fresh Chrome instance per ticker so that each request gets a clean
    Cloudflare fingerprint — a single session triggers the CF JS challenge on
    every page after the first (the cf_clearance cookie is domain-wide but CF
    re-challenges on new navigation in headless mode).

    Two URL visits:
      1. #etf-ticker-profile  → parse info
      2. #holdings            → parse holdings (table already in DOM, no reload)
    """
    result: Dict[str, Any] = {'ticker': ticker, 'info': None, 'holdings': []}

    if not _SELENIUM_AVAILABLE or BeautifulSoup is None:
        return result

    driver = _make_driver(headless=headless)
    try:
        base_url = f"{_ETFDB_BASE}/{ticker.upper()}/"

        # --- Visit 1: profile tab ---
        print(f"    → {base_url}#etf-ticker-profile")
        driver.get(base_url + '#etf-ticker-profile')

        if not _wait_for_content(driver):
            print(f"    [warn] real page never loaded for {ticker}")
            return result

        time.sleep(_TAB_SETTLE)
        soup = BeautifulSoup(driver.page_source, 'html.parser')
        result['info'] = _parse_info(soup, ticker)
        name = result['info'].get('name') if result['info'] else None
        print(f"    info: {'OK' if result['info'] else 'None'} — {name or ''}")

        # --- Visit 2: holdings tab (hash change — no full reload) ---
        print(f"    → {base_url}#holdings")
        _navigate_to_holdings(driver, base_url)
        _wait_for_holdings(driver)
        time.sleep(_TAB_SETTLE)

        soup = BeautifulSoup(driver.page_source, 'html.parser')
        result['holdings'] = _parse_holdings(soup, ticker)
        print(f"    holdings: {len(result['holdings'])} rows")

    except Exception as e:
        print(f"    [error] {ticker}: {e}")
    finally:
        driver.quit()

    return result


def scrape_all_etfs(
    tickers: List[str],
    headless: bool = True,
) -> List[Dict[str, Any]]:
    """
    Scrape all ETFs, using a fresh browser session per ticker to avoid
    Cloudflare re-challenges that block a single long-running session.

    Returns a list of result dicts (one per ticker):
        {'ticker': str, 'info': dict | None, 'holdings': list[dict]}

    All DB writes are handled by the caller (sync_etfdb_data in markets_db_helper).
    """
    if not _SELENIUM_AVAILABLE:
        print("[etfdb] selenium or webdriver-manager not installed")
        return [{'ticker': t, 'info': None, 'holdings': []} for t in tickers]
    if BeautifulSoup is None:
        print("[etfdb] beautifulsoup4 not installed")
        return [{'ticker': t, 'info': None, 'holdings': []} for t in tickers]

    results: List[Dict[str, Any]] = []

    for i, ticker in enumerate(tickers):
        print(f"\n  [{ticker}] ({i+1}/{len(tickers)})")
        result = _scrape_one_etf(ticker, headless=headless)
        results.append(result)

        if i < len(tickers) - 1:
            print(f"    sleeping {_INTER_ETF_DELAY}s before next ETF...")
            time.sleep(_INTER_ETF_DELAY)

    return results


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _extract_kv(soup: "BeautifulSoup") -> Dict[str, str]:
    """
    Collect label→value pairs from <table> rows and <dl> definition lists.
    Used for FactSet Classifications (Segment, Focus, Niche, Strategy, etc.)
    and the holdings stats table.
    """
    kv: Dict[str, str] = {}
    for row in soup.find_all('tr'):
        cells = row.find_all('td')
        if len(cells) >= 2:
            label = cells[0].get_text(strip=True)
            value = cells[1].get_text(strip=True)
            if label and value:
                kv.setdefault(label.lower().rstrip(':'), value)
    for dl in soup.find_all('dl'):
        for dt, dd in zip(dl.find_all('dt'), dl.find_all('dd')):
            label = dt.get_text(strip=True)
            value = dd.get_text(strip=True)
            if label and value:
                kv.setdefault(label.lower().rstrip(':'), value)
    return kv


def _extract_divrow_kv(soup: "BeautifulSoup") -> Dict[str, str]:
    """
    Collect label→value pairs from <div class="row"> span pairs.
    Covers two patterns used by etfdb.com:
      <span class="stock-quote-title">Label</span>
      <span class="stock-quote-data">Value</span>

      <span>Label</span>
      <span class="truncate-index">Value</span>

    Used for: vitals (Issuer, Expense Ratio, Inception, Index Tracked) and
    ETF Database Themes (Category, Asset Class, Region, etc.).
    First occurrence wins so the vitals section takes priority over repetitions.
    """
    kv: Dict[str, str] = {}
    for div in soup.find_all('div', class_='row'):
        spans = div.find_all('span', recursive=False)
        if len(spans) < 2:
            continue
        label = spans[0].get_text(strip=True).lower().rstrip(':')
        value = spans[1].get_text(strip=True)
        if label and value:
            kv.setdefault(label, value)
    return kv


def _try_parse_date(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    for fmt in ('%m/%d/%Y', '%B %d, %Y', '%Y-%m-%d', '%b %d, %Y'):
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _parse_float(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    try:
        return float(s.replace('%', '').replace('$', '').replace(',', '').strip())
    except ValueError:
        return None


def _parse_int(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    try:
        return int(float(s.replace(',', '').replace(' ', '').strip()))
    except ValueError:
        return None
