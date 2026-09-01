"""
words.py

Helpers for Merriam-Webster Word of the Day (RSS feed).
"""

from typing import Any, Dict, List
from datetime import datetime
import requests
import html
import re
import xml.etree.ElementTree as ET

from dotenv import load_dotenv

load_dotenv()

MERRIAM_WOTD_RSS = "https://www.merriam-webster.com/wotd/feed/rss2"

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


PARTS_OF_SPEECH = (
    "noun", "verb", "adjective", "adverb", "preposition",
    "conjunction", "pronoun", "interjection", "abbreviation",
)


def _parse_wotd(word: str, description: str) -> Dict[str, Any]:
    """Split the RSS blurb into pronunciation / part of speech / definition.

    The feed ships one prose blob shaped like:
        "Merriam-Webster's Word of the Day for {date} is: {word}
         • \\{pronunciation}\\ • {part of speech} {definition} // {example}"
    Rendered whole it is mostly boilerplate, so pull the parts the card
    actually wants and keep the raw text as a fallback.
    """
    out: Dict[str, Any] = {
        "pronunciation": None,
        "part_of_speech": None,
        "definition": None,
        "example": None,
    }

    segments = [seg.strip() for seg in description.split("•")]
    if len(segments) >= 3:
        out["pronunciation"] = segments[1].strip("\\ ") or None
        body = " ".join(segments[2:]).strip()
    else:
        # Unexpected shape — drop the "... is: {word}" preamble if present.
        body = description.split(" is: ", 1)[-1]
        if body.lower().startswith(word.lower()):
            body = body[len(word):].strip()

    # "See the entry >" is a link stub left behind by the HTML strip.
    body = body.split("See the entry")[0].strip()

    for pos in PARTS_OF_SPEECH:
        if body.lower().startswith(pos):
            out["part_of_speech"] = pos
            body = body[len(pos):].strip()
            break

    if "//" in body:
        definition, example = body.split("//", 1)
        out["definition"] = definition.strip() or None
        out["example"] = example.strip().rstrip("/ ").strip() or None
    else:
        out["definition"] = body or None

    return out


def _strip_html(raw: str) -> str:
    """Flatten the RSS description's HTML into readable prose.

    The feed ships a full HTML fragment (<font>, <strong>, entity-escaped
    pronunciation markup). Stored verbatim it renders as visible tag soup, so
    unescape entities first, then drop tags, then collapse whitespace. Entities
    are unescaped twice because the feed double-encodes them (&amp;#149;).
    """
    text = html.unescape(html.unescape(raw or ""))
    text = _TAG_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


def fetch_merriam_webster_wotd(limit: int = 1) -> List[Dict[str, Any]]:
    """
    Fetch Merriam-Webster Word of the Day items from the public RSS feed.

    Args:
        limit: Maximum number of items to return.

    Returns:
        List of dictionaries with title, link, pub_date, and description.
    """
    try:
        response = requests.get(MERRIAM_WOTD_RSS, timeout=10)
        response.raise_for_status()
        xml_text = response.text
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Merriam-Webster WOTD RSS: {e}")
        return []

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        print(f"Error parsing Merriam-Webster WOTD RSS XML: {e}")
        return []

    items: List[Dict[str, Any]] = []

    # RSS structure: <rss><channel><item>...</item></channel></rss>
    channel = root.find("channel")
    if channel is None:
        return items

    for item in channel.findall("item")[:limit]:
        # The feed ships the headword lowercased; the card renders it as a
        # display title, so capitalize without touching the rest of the entry.
        title = (item.findtext("title") or "").strip()
        if title:
            title = title[0].upper() + title[1:]
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        description = _strip_html(item.findtext("description") or "")

        items.append(
            {
                "title": title,
                "link": link,
                "pub_date": pub_date,
                "description": description,
                **_parse_wotd(title, description),
                "source": "Merriam-Webster WOTD",
                "fetched_at": datetime.utcnow().isoformat(),
            }
        )

    return items


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Merriam-Webster WOTD RSS")
    print("=" * 60)

    words = fetch_merriam_webster_wotd(limit=3)
    for w in words:
        print(f"{w['title']} — {w['pub_date']}")

