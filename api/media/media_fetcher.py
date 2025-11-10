"""
Media API Script
Fetches media content from various sources
"""

import os
import requests
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

def fetch_youtube_trending():
    """Fetch trending YouTube videos"""
    api_key = os.getenv('YOUTUBE_API_KEY')
    if not api_key:
        print("YOUTUBE_API_KEY not found")
        return None
    
    url = "https://www.googleapis.com/youtube/v3/videos"
    params = {
        'part': 'snippet,statistics',
        'chart': 'mostPopular',
        'regionCode': 'US',
        'maxResults': 10,
        'key': api_key
    }
    
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        
        videos = []
        for item in data.get('items', []):
            snippet = item.get('snippet', {})
            stats = item.get('statistics', {})
            
            videos.append({
                'title': snippet.get('title'),
                'description': snippet.get('description'),
                'channel_title': snippet.get('channelTitle'),
                'published_at': snippet.get('publishedAt'),
                'view_count': stats.get('viewCount'),
                'like_count': stats.get('likeCount'),
                'video_id': item.get('id'),
                'thumbnail': snippet.get('thumbnails', {}).get('high', {}).get('url')
            })
        
        return videos
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching YouTube data: {e}")
        return None

def fetch_twitter_trends():
    """Fetch Twitter trending topics"""
    # Note: Twitter API v2 requires authentication
    # This is a placeholder for Twitter API implementation
    bearer_token = os.getenv('TWITTER_BEARER_TOKEN')
    if not bearer_token:
        print("TWITTER_BEARER_TOKEN not found")
        return None
    
    url = "https://api.twitter.com/2/trends/by/woeid/1"  # Worldwide trends
    headers = {
        'Authorization': f'Bearer {bearer_token}'
    }
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        trends = []
        for trend in data.get('trends', []):
            trends.append({
                'name': trend.get('name'),
                'url': trend.get('url'),
                'tweet_volume': trend.get('tweet_volume'),
                'promoted_content': trend.get('promoted_content')
            })
        
        return trends
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Twitter trends: {e}")
        return None

def fetch_reddit_hot():
    """Fetch hot posts from Reddit"""
    # Reddit API doesn't require authentication for public data
    url = "https://www.reddit.com/r/all/hot.json"
    headers = {
        'User-Agent': 'InfoAggregator/1.0'
    }
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        posts = []
        for post in data.get('data', {}).get('children', []):
            post_data = post.get('data', {})
            posts.append({
                'title': post_data.get('title'),
                'subreddit': post_data.get('subreddit'),
                'author': post_data.get('author'),
                'score': post_data.get('score'),
                'num_comments': post_data.get('num_comments'),
                'url': post_data.get('url'),
                'created_utc': post_data.get('created_utc'),
                'thumbnail': post_data.get('thumbnail')
            })
        
        return posts
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Reddit data: {e}")
        return None

if __name__ == "__main__":
    print("Fetching media data...")
    
    # Fetch YouTube trending videos
    youtube_data = fetch_youtube_trending()
    if youtube_data:
        print(f"\nYouTube Trending Videos ({len(youtube_data)} found):")
        for video in youtube_data[:3]:  # Show first 3
            print(f"- {video['title']} by {video['channel_title']}")
    
    # Fetch Twitter trends
    twitter_data = fetch_twitter_trends()
    if twitter_data:
        print(f"\nTwitter Trends ({len(twitter_data)} found):")
        for trend in twitter_data[:5]:  # Show first 5
            print(f"- #{trend['name']}")
    
    # Fetch Reddit hot posts
    reddit_data = fetch_reddit_hot()
    if reddit_data:
        print(f"\nReddit Hot Posts ({len(reddit_data)} found):")
        for post in reddit_data[:3]:  # Show first 3
            print(f"- {post['title']} (r/{post['subreddit']})")
