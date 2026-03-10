"""
facts.py

Wrapper for the uselessfacts.jsph.pl API.
"""

from typing import Any, Dict, Optional
from datetime import datetime
import requests

from dotenv import load_dotenv

load_dotenv()

USELESS_FACTS_URL = "https://uselessfacts.jsph.pl/random.json"


def fetch_useless_fact(language: str = "en") -> Optional[Dict[str, Any]]:
    """
    Fetch a random useless fact.

    Args:
        language: Language code (default 'en').

    Returns:
        Dict with fact fields, or None on error.
    """
    params = {"language": language}

    try:
        response = requests.get(USELESS_FACTS_URL, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        return {
            "text": data.get("text"),
            "source": data.get("source"),
            "source_url": data.get("source_url"),
            "permalink": data.get("permalink"),
            "language": language,
            "fetched_at": datetime.utcnow().isoformat(),
        }
    except requests.exceptions.RequestException as e:
        print(f"Error fetching useless fact: {e}")
        return None
    except ValueError as e:
        print(f"Error parsing useless fact: {e}")
        return None


if __name__ == "__main__":
    print("=" * 60)
    print("Testing uselessfacts.jsph.pl API")
    print("=" * 60)

    fact = fetch_useless_fact()
    if fact:
        print(fact["text"])

