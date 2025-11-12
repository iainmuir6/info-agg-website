"""
News API Script
Fetches news data from various sources
"""

import os
import requests
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

def fetch_news_api_data():
    """Fetch data from NewsAPI"""
    api_key = os.getenv('NEWS_API_KEY')
    if not api_key:
        print("NEWS_API_KEY not found in environment variables")
        return None
    
    url = "https://newsapi.org/v2/top-headlines"
    params = {
        'country': 'us',
        'apiKey': api_key,
        'pageSize': 20
    }
    
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        
        # Process articles
        articles = []
        for article in data.get('articles', []):
            articles.append({
                'title': article.get('title'),
                'description': article.get('description'),
                'url': article.get('url'),
                'published_at': article.get('publishedAt'),
                'source': article.get('source', {}).get('name')
            })
        
        return articles
    except requests.exceptions.RequestException as e:
        print(f"Error fetching news data: {e}")
        return None


def fetch_rss_feeds():
    """Fetch data from RSS feeds"""
    # Example RSS feeds
    rss_feeds = [
        'https://feeds.bbci.co.uk/news/rss.xml',
        'https://rss.cnn.com/rss/edition.rss',
        'https://feeds.reuters.com/reuters/topNews'
    ]
    
    # Implementation would use feedparser or similar library
    # This is a placeholder for RSS parsing logic
    return []

if __name__ == "__main__":
    print("Fetching news data...")
    news_data = fetch_news_api_data()
    if news_data:
        print(f"Fetched {len(news_data)} news articles")
        for article in news_data[:3]:  # Show first 3 articles
            print(f"- {article['title']}")
    else:
        print("Failed to fetch news data")
