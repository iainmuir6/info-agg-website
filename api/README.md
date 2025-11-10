# API Directory

This directory contains Python scripts for fetching data from various APIs and external sources.

## Structure

- `news/` - Scripts for news APIs (NewsAPI, RSS feeds, etc.)
- `sports/` - Scripts for sports data (ESPN, sports APIs, etc.)
- `markets/` - Scripts for financial data (Alpha Vantage, Yahoo Finance, etc.)
- `media/` - Scripts for media content (YouTube API, social media APIs, etc.)
- `misc/` - Scripts for miscellaneous data sources

## Setup

1. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Create a `.env` file in the root directory with your API keys:
   ```
   NEWS_API_KEY=your_news_api_key
   ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key
   YOUTUBE_API_KEY=your_youtube_api_key
   # Add other API keys as needed
   ```

## Usage

Each script should be designed to:
1. Fetch data from external APIs
2. Process and clean the data
3. Store data in Supabase or return structured data
4. Handle errors gracefully

## Example Script Structure

```python
import os
import requests
from dotenv import load_dotenv

load_dotenv()

def fetch_data():
    api_key = os.getenv('API_KEY')
    # Your API logic here
    pass

if __name__ == "__main__":
    fetch_data()
```
