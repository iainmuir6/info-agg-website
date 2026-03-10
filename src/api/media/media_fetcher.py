# media_fetcher.py
#
# Author: IM
# Company: Scouts Consulting Group
# Date: Thu Nov 13 2025
# Description: Fetches media data from Spotify API and other sources
#       ---> Supports recommended songs/podcasts, top songs, new releases, and more

from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
import requests
import os
import base64
import time

# Load Environment Variables
from dotenv import load_dotenv
load_dotenv()

# API base URLs
SPOTIFY_BASE_URL = "https://api.spotify.com/v1"
SPOTIFY_AUTH_URL = "https://accounts.spotify.com/api/token"
REDDIT_BASE_URL = "https://www.reddit.com"


def get_spotify_client_credentials() -> Tuple[str, str]:
    """
    Get Spotify client ID and secret from environment variables
    
    Returns:
        Tuple of (client_id, client_secret)
    """
    client_id = os.getenv('SPOTIFY_CLIENT_ID')
    client_secret = os.getenv('SPOTIFY_CLIENT_SECRET')
    
    if not client_id or not client_secret:
        raise ValueError("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in environment variables")
    
    return client_id, client_secret


def get_spotify_access_token(client_id: Optional[str] = None, client_secret: Optional[str] = None) -> Optional[str]:
    """
    Get Spotify access token using Client Credentials flow
    
    Args:
        client_id: Optional client ID (will fetch from env if not provided)
        client_secret: Optional client secret (will fetch from env if not provided)
    
    Returns:
        Access token string or None if failed
    """
    if client_id is None or client_secret is None:
        client_id, client_secret = get_spotify_client_credentials()
    
    # Encode credentials
    credentials = f"{client_id}:{client_secret}"
    encoded_credentials = base64.b64encode(credentials.encode()).decode()
    
    headers = {
        'Authorization': f'Basic {encoded_credentials}',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    
    data = {
        'grant_type': 'client_credentials'
    }
    
    try:
        response = requests.post(SPOTIFY_AUTH_URL, headers=headers, data=data, timeout=10)
        response.raise_for_status()
        token_data = response.json()
        
        return token_data.get('access_token')
        
    except requests.exceptions.RequestException as e:
        print(f"Error getting Spotify access token: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Spotify token response: {e}")
        return None


# ============================================================================
# SPOTIFY API FUNCTIONS
# ============================================================================

def fetch_spotify_new_releases(
    country: str = 'US',
    limit: int = 20,
    offset: int = 0,
    access_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch new album releases from Spotify
    
    Args:
        country: Country code (ISO 3166-1 alpha-2)
        limit: Number of albums to return (1-50)
        offset: Index of first album to return
        access_token: Optional access token (will fetch if not provided)
    
    Returns:
        Dictionary with new releases data
    """
    if access_token is None:
        access_token = get_spotify_access_token()
        if not access_token:
            return None
    
    url = f"{SPOTIFY_BASE_URL}/browse/new-releases"
    headers = {
        'Authorization': f'Bearer {access_token}'
    }
    params = {
        'country': country,
        'limit': min(limit, 50),  # Cap at 50
        'offset': offset
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        albums = []
        for album in data.get('albums', {}).get('items', []):
            # Extract artists
            artists = []
            for artist in album.get('artists', []):
                artists.append({
                    'id': artist.get('id'),
                    'name': artist.get('name'),
                    'uri': artist.get('uri')
                })
            
            # Extract images
            images = []
            for img in album.get('images', []):
                images.append({
                    'url': img.get('url'),
                    'height': img.get('height'),
                    'width': img.get('width')
                })
            
            albums.append({
                'album_id': album.get('id'),
                'name': album.get('name'),
                'album_type': album.get('album_type'),
                'artists': artists,
                'available_markets': album.get('available_markets', []),
                'external_urls': album.get('external_urls', {}),
                'href': album.get('href'),
                'uri': album.get('uri'),
                'images': images,
                'release_date': album.get('release_date'),
                'release_date_precision': album.get('release_date_precision'),
                'total_tracks': album.get('total_tracks'),
                'fetched_at': datetime.now().isoformat()
            })
        
        return {
            'country': country,
            'albums': albums,
            'total': data.get('albums', {}).get('total', 0),
            'limit': params['limit'],
            'offset': params['offset'],
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Spotify new releases: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Spotify new releases: {e}")
        return None


def fetch_spotify_user_top_items(
    type: str = 'artists',
    time_range: str = 'medium_term',
    limit: int = 20,
    offset: int = 0,
    user_access_token: str = None
) -> Optional[Dict[str, Any]]:
    """
    Get user's top artists, tracks, or albums from Spotify
    Note: Requires user authorization (user-read-top-type scope), not client credentials
    
    Args:
        type: Type of items (artists, tracks)
        time_range: Time range (short_term: ~4 weeks, medium_term: ~6 months, long_term: all time)
        limit: Number of items to return (1-50)
        offset: Index of first item to return
        user_access_token: User access token (required - different from client credentials token)
    
    Returns:
        Dictionary with user's top items
    """
    if user_access_token is None:
        raise ValueError("User access token is required for this endpoint. Use OAuth authorization code flow.")
    
    if type not in ['artists', 'tracks']:
        raise ValueError("Type must be 'artists' or 'tracks'")
    
    url = f"{SPOTIFY_BASE_URL}/me/top/{type}"
    headers = {
        'Authorization': f'Bearer {user_access_token}'
    }
    params = {
        'time_range': time_range,
        'limit': min(limit, 50),
        'offset': offset
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        
        # Check for 401 (unauthorized) before raising
        if response.status_code == 401:
            print("Note: This endpoint requires user authorization. Use OAuth authorization code flow.")
            return None
        
        response.raise_for_status()
        data = response.json()
        
        items = []
        for item in data.get('items', []):
            if type == 'artists':
                # Extract images
                images = []
                for img in item.get('images', []):
                    images.append({
                        'url': img.get('url'),
                        'height': img.get('height'),
                        'width': img.get('width')
                    })
                
                items.append({
                    'artist_id': item.get('id'),
                    'name': item.get('name'),
                    'genres': item.get('genres', []),
                    'popularity': item.get('popularity'),
                    'images': images,
                    'external_urls': item.get('external_urls', {}),
                    'href': item.get('href'),
                    'uri': item.get('uri'),
                    'followers': item.get('followers', {}).get('total', 0),
                    'fetched_at': datetime.now().isoformat()
                })
            else:  # tracks
                # Extract artists
                artists = []
                for artist in item.get('artists', []):
                    artists.append({
                        'id': artist.get('id'),
                        'name': artist.get('name'),
                        'uri': artist.get('uri')
                    })
                
                # Extract album info
                album = item.get('album', {})
                album_images = []
                for img in album.get('images', []):
                    album_images.append({
                        'url': img.get('url'),
                        'height': img.get('height'),
                        'width': img.get('width')
                    })
                
                items.append({
                    'track_id': item.get('id'),
                    'name': item.get('name'),
                    'artists': artists,
                    'album': {
                        'id': album.get('id'),
                        'name': album.get('name'),
                        'album_type': album.get('album_type'),
                        'images': album_images,
                        'release_date': album.get('release_date')
                    },
                    'duration_ms': item.get('duration_ms'),
                    'explicit': item.get('explicit'),
                    'external_urls': item.get('external_urls', {}),
                    'href': item.get('href'),
                    'uri': item.get('uri'),
                    'popularity': item.get('popularity'),
                    'preview_url': item.get('preview_url'),
                    'fetched_at': datetime.now().isoformat()
                })
        
        return {
            'type': type,
            'time_range': time_range,
            'items': items,
            'total': data.get('total', 0),
            'limit': params['limit'],
            'offset': params['offset'],
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Spotify user top items: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Spotify user top items: {e}")
        return None


def fetch_spotify_related_artists(
    artist_id: str,
    access_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Get artists related to a given artist
    
    Args:
        artist_id: Spotify artist ID
        access_token: Optional access token (can use client credentials)
    
    Returns:
        Dictionary with related artists
    """
    if access_token is None:
        access_token = get_spotify_access_token()
        if not access_token:
            return None
    
    url = f"{SPOTIFY_BASE_URL}/artists/{artist_id}/related-artists"
    headers = {
        'Authorization': f'Bearer {access_token}'
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        artists = []
        for artist in data.get('artists', []):
            # Extract images
            images = []
            for img in artist.get('images', []):
                images.append({
                    'url': img.get('url'),
                    'height': img.get('height'),
                    'width': img.get('width')
                })
            
            artists.append({
                'artist_id': artist.get('id'),
                'name': artist.get('name'),
                'genres': artist.get('genres', []),
                'popularity': artist.get('popularity'),
                'images': images,
                'external_urls': artist.get('external_urls', {}),
                'href': artist.get('href'),
                'uri': artist.get('uri'),
                'followers': artist.get('followers', {}).get('total', 0),
                'fetched_at': datetime.now().isoformat()
            })
        
        return {
            'seed_artist_id': artist_id,
            'related_artists': artists,
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Spotify related artists: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Spotify related artists: {e}")
        return None


def fetch_spotify_recommendations(
    seed_artists: Optional[List[str]] = None,
    seed_genres: Optional[List[str]] = None,
    seed_tracks: Optional[List[str]] = None,
    limit: int = 20,
    country: str = 'US',
    access_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch recommended tracks from Spotify based on seed artists, genres, or tracks
    
    Args:
        seed_artists: List of artist IDs (max 5 total seeds)
        seed_genres: List of genre names (max 5 total seeds)
        seed_tracks: List of track IDs (max 5 total seeds)
        limit: Number of tracks to return (1-100)
        country: Country code for market filtering
        access_token: Optional access token
    
    Returns:
        Dictionary with recommended tracks
    """
    if access_token is None:
        access_token = get_spotify_access_token()
        if not access_token:
            return None
    
    # Validate seeds (must have at least 1, max 5 total)
    if not seed_artists and not seed_genres and not seed_tracks:
        raise ValueError("At least one seed (artist, genre, or track) is required")
    
    url = f"{SPOTIFY_BASE_URL}/recommendations"
    headers = {
        'Authorization': f'Bearer {access_token}'
    }
    params = {
        'limit': min(limit, 100),  # Cap at 100
        'market': country
    }
    
    # Add seeds to params (max 5 total seeds across all types)
    seed_count = 0
    
    if seed_artists:
        seed_artists_list = seed_artists[:min(5, 5 - seed_count)]
        if seed_artists_list:
            params['seed_artists'] = ','.join(seed_artists_list)
            seed_count += len(seed_artists_list)
    
    if seed_genres and seed_count < 5:
        remaining = 5 - seed_count
        seed_genres_list = seed_genres[:remaining]
        if seed_genres_list:
            params['seed_genres'] = ','.join(seed_genres_list)
            seed_count += len(seed_genres_list)
    
    if seed_tracks and seed_count < 5:
        remaining = 5 - seed_count
        seed_tracks_list = seed_tracks[:remaining]
        if seed_tracks_list:
            params['seed_tracks'] = ','.join(seed_tracks_list)
            seed_count += len(seed_tracks_list)
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        tracks = []
        for track in data.get('tracks', []):
            # Extract artists
            artists = []
            for artist in track.get('artists', []):
                artists.append({
                    'id': artist.get('id'),
                    'name': artist.get('name'),
                    'uri': artist.get('uri')
                })
            
            # Extract album info
            album = track.get('album', {})
            album_images = []
            for img in album.get('images', []):
                album_images.append({
                    'url': img.get('url'),
                    'height': img.get('height'),
                    'width': img.get('width')
                })
            
            tracks.append({
                'track_id': track.get('id'),
                'name': track.get('name'),
                'artists': artists,
                'album': {
                    'id': album.get('id'),
                    'name': album.get('name'),
                    'album_type': album.get('album_type'),
                    'images': album_images,
                    'release_date': album.get('release_date')
                },
                'duration_ms': track.get('duration_ms'),
                'explicit': track.get('explicit'),
                'external_urls': track.get('external_urls', {}),
                'href': track.get('href'),
                'uri': track.get('uri'),
                'popularity': track.get('popularity'),
                'preview_url': track.get('preview_url'),
                'track_number': track.get('track_number'),
                'disc_number': track.get('disc_number'),
                'fetched_at': datetime.now().isoformat()
            })
        
        return {
            'seeds': {
                'artists': seed_artists[:min(5, len(seed_artists or []))] if seed_artists else [],
                'genres': seed_genres[:min(5, len(seed_genres or []))] if seed_genres else [],
                'tracks': seed_tracks[:min(5, len(seed_tracks or []))] if seed_tracks else []
            },
            'tracks': tracks,
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Spotify recommendations: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Spotify recommendations: {e}")
        return None


def fetch_spotify_featured_playlists(
    country: str = 'US',
    limit: int = 20,
    offset: int = 0,
    access_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch featured playlists from Spotify (includes popular/top playlists)
    
    Args:
        country: Country code
        limit: Number of playlists to return (1-50)
        offset: Index of first playlist to return
        access_token: Optional access token
    
    Returns:
        Dictionary with featured playlists data
    """
    if access_token is None:
        access_token = get_spotify_access_token()
        if not access_token:
            return None
    
    url = f"{SPOTIFY_BASE_URL}/browse/featured-playlists"
    headers = {
        'Authorization': f'Bearer {access_token}'
    }
    params = {
        'country': country,
        'limit': min(limit, 50),
        'offset': offset
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        playlists = []
        for playlist in data.get('playlists', {}).get('items', []):
            # Extract images
            images = []
            for img in playlist.get('images', []):
                images.append({
                    'url': img.get('url'),
                    'height': img.get('height'),
                    'width': img.get('width')
                })
            
            # Extract owner
            owner = playlist.get('owner', {})
            
            playlists.append({
                'playlist_id': playlist.get('id'),
                'name': playlist.get('name'),
                'description': playlist.get('description'),
                'owner': {
                    'id': owner.get('id'),
                    'display_name': owner.get('display_name'),
                    'uri': owner.get('uri')
                },
                'images': images,
                'tracks_count': playlist.get('tracks', {}).get('total', 0),
                'external_urls': playlist.get('external_urls', {}),
                'href': playlist.get('href'),
                'uri': playlist.get('uri'),
                'public': playlist.get('public'),
                'collaborative': playlist.get('collaborative'),
                'fetched_at': datetime.now().isoformat()
            })
        
        return {
            'country': country,
            'message': data.get('message', ''),
            'playlists': playlists,
            'total': data.get('playlists', {}).get('total', 0),
            'limit': params['limit'],
            'offset': params['offset'],
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Spotify featured playlists: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Spotify featured playlists: {e}")
        return None


def fetch_spotify_artist_top_tracks(
    artist_id: str,
    country: str = 'US',
    access_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch top tracks for a specific artist
    
    Args:
        artist_id: Spotify artist ID
        country: Country code
        access_token: Optional access token
    
    Returns:
        Dictionary with artist's top tracks
    """
    if access_token is None:
        access_token = get_spotify_access_token()
        if not access_token:
            return None
    
    url = f"{SPOTIFY_BASE_URL}/artists/{artist_id}/top-tracks"
    headers = {
        'Authorization': f'Bearer {access_token}'
    }
    params = {
        'market': country
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        tracks = []
        for track in data.get('tracks', []):
            # Extract artists
            artists = []
            for artist in track.get('artists', []):
                artists.append({
                    'id': artist.get('id'),
                    'name': artist.get('name'),
                    'uri': artist.get('uri')
                })
            
            # Extract album info
            album = track.get('album', {})
            album_images = []
            for img in album.get('images', []):
                album_images.append({
                    'url': img.get('url'),
                    'height': img.get('height'),
                    'width': img.get('width')
                })
            
            tracks.append({
                'track_id': track.get('id'),
                'name': track.get('name'),
                'artists': artists,
                'album': {
                    'id': album.get('id'),
                    'name': album.get('name'),
                    'album_type': album.get('album_type'),
                    'images': album_images,
                    'release_date': album.get('release_date')
                },
                'duration_ms': track.get('duration_ms'),
                'explicit': track.get('explicit'),
                'external_urls': track.get('external_urls', {}),
                'href': track.get('href'),
                'uri': track.get('uri'),
                'popularity': track.get('popularity'),
                'preview_url': track.get('preview_url'),
                'track_number': track.get('track_number'),
                'disc_number': track.get('disc_number'),
                'fetched_at': datetime.now().isoformat()
            })
        
        return {
            'artist_id': artist_id,
            'country': country,
            'tracks': tracks,
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Spotify artist top tracks: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Spotify artist top tracks: {e}")
        return None


def fetch_spotify_recommendations_from_user_top(
    user_access_token: str,
    time_range: str = 'medium_term',
    limit: int = 20,
    country: str = 'US',
    use_related_artists: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Get recommendations based on user's top artists
    This function chains: Get User's Top Artists -> Get Related Artists -> Get Recommendations
    
    Args:
        user_access_token: User access token (from OAuth flow)
        time_range: Time range for top artists (short_term, medium_term, long_term)
        limit: Number of recommended tracks to return
        country: Country code
        use_related_artists: If True, also include related artists in seeds
    
    Returns:
        Dictionary with recommended tracks
    """
    # Step 1: Get user's top artists
    top_artists_data = fetch_spotify_user_top_items(
        type='artists',
        time_range=time_range,
        limit=5,  # Get top 5 artists
        user_access_token=user_access_token
    )
    
    if not top_artists_data or not top_artists_data.get('items'):
        print("No top artists found for user")
        return None
    
    top_artist_ids = [artist['artist_id'] for artist in top_artists_data['items']]
    
    # Step 2: Optionally get related artists
    seed_artist_ids = top_artist_ids.copy()
    
    if use_related_artists and top_artist_ids:
        # Get related artists for the first top artist
        related_artists_data = fetch_spotify_related_artists(
            top_artist_ids[0],
            access_token=get_spotify_access_token()  # Related artists can use client credentials
        )
        
        if related_artists_data and related_artists_data.get('related_artists'):
            # Add up to 2 related artists (keeping total seeds <= 5)
            related_ids = [a['artist_id'] for a in related_artists_data['related_artists'][:2]]
            seed_artist_ids.extend(related_ids)
            seed_artist_ids = seed_artist_ids[:5]  # Max 5 seeds
    
    # Step 3: Get recommendations using the artist seeds
    recommendations = fetch_spotify_recommendations(
        seed_artists=seed_artist_ids[:5],  # Max 5 artist seeds
        limit=limit,
        country=country,
        access_token=get_spotify_access_token()  # Recommendations can use client credentials
    )
    
    if recommendations:
        recommendations['source'] = {
            'top_artists': top_artists_data['items'],
            'related_artists_used': use_related_artists,
            'seed_artist_ids': seed_artist_ids
        }
    
    return recommendations


def fetch_spotify_search(
    query: str,
    types: List[str] = ['track', 'album', 'artist'],
    limit: int = 20,
    offset: int = 0,
    country: str = 'US',
    access_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Search for tracks, albums, artists, playlists, shows, or episodes on Spotify
    
    Args:
        query: Search query string
        types: List of types to search (track, album, artist, playlist, show, episode)
        limit: Number of results per type (1-50)
        offset: Index of first result
        country: Country code
        access_token: Optional access token
    
    Returns:
        Dictionary with search results
    """
    if access_token is None:
        access_token = get_spotify_access_token()
        if not access_token:
            return None
    
    url = f"{SPOTIFY_BASE_URL}/search"
    headers = {
        'Authorization': f'Bearer {access_token}'
    }
    params = {
        'q': query,
        'type': ','.join(types),
        'limit': min(limit, 50),
        'offset': offset,
        'market': country
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        return {
            'query': query,
            'types': types,
            'results': data,
            'fetched_at': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Spotify search: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Spotify search: {e}")
        return None


# ============================================================================
# REDDIT API FUNCTIONS
# ============================================================================

def fetch_reddit_hot(subreddit: str = 'all', limit: int = 25) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch hot posts from Reddit
    
    Args:
        subreddit: Subreddit name (default: 'all')
        limit: Number of posts to fetch (max 100)
    
    Returns:
        List of post dictionaries
    """
    url = f"{REDDIT_BASE_URL}/r/{subreddit}/hot.json"
    headers = {
        'User-Agent': 'InfoAggregator/1.0'
    }
    params = {
        'limit': min(limit, 100)
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        posts = []
        for post in data.get('data', {}).get('children', []):
            post_data = post.get('data', {})
            posts.append({
                'post_id': post_data.get('id'),
                'title': post_data.get('title'),
                'subreddit': post_data.get('subreddit'),
                'author': post_data.get('author'),
                'score': post_data.get('score'),
                'upvote_ratio': post_data.get('upvote_ratio'),
                'num_comments': post_data.get('num_comments'),
                'url': post_data.get('url'),
                'permalink': f"https://www.reddit.com{post_data.get('permalink', '')}",
                'created_utc': post_data.get('created_utc'),
                'thumbnail': post_data.get('thumbnail'),
                'selftext': post_data.get('selftext'),
                'is_self': post_data.get('is_self'),
                'is_video': post_data.get('is_video'),
                'over_18': post_data.get('over_18'),
                'link_flair_text': post_data.get('link_flair_text'),
                'fetched_at': datetime.now().isoformat()
            })
        
        return posts
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Reddit data: {e}")
        return None
    except Exception as e:
        print(f"Error parsing Reddit data: {e}")
        return None


if __name__ == "__main__":
    print("=" * 60)
    print("Fetching media data from Spotify API...")
    print("=" * 60)
    
    try:
        # Get access token
        print("\n--- Getting Spotify Access Token ---")
        access_token = get_spotify_access_token()
        if not access_token:
            print("Failed to get access token")
            exit(1)
        print("Access token obtained successfully")
        
        # Test fetching new releases
        print("\n--- Testing New Releases (Spotify) ---")
        new_releases = fetch_spotify_new_releases(country='US', limit=10, access_token=access_token)
        if new_releases:
            print(f"Found {new_releases.get('total', 0)} new releases")
            for album in new_releases.get('albums', [])[:3]:  # Show first 3
                artist_names = ', '.join([a['name'] for a in album.get('artists', [])])
                print(f"  - {album.get('name')} by {artist_names}")
                print(f"    Release Date: {album.get('release_date')}")
        
        # Test fetching featured playlists (top/popular playlists)
        print("\n--- Testing Featured Playlists (Spotify) ---")
        featured = fetch_spotify_featured_playlists(country='US', limit=10, access_token=access_token)
        if featured:
            print(f"Message: {featured.get('message', 'N/A')}")
            print(f"Found {featured.get('total', 0)} playlists")
            for playlist in featured.get('playlists', [])[:3]:  # Show first 3
                print(f"  - {playlist.get('name')}")
                print(f"    Tracks: {playlist.get('tracks_count')}")
                print(f"    Description: {playlist.get('description', 'N/A')[:50]}...")
        
        # Test fetching recommendations (using search to get an artist ID)
        print("\n--- Testing Recommendations (Spotify) ---")
        # First, search for a popular artist to get their ID
        
        # Test Reddit
        print("\n--- Testing Reddit Hot Posts ---")
        reddit_data = fetch_reddit_hot('all', limit=5)
        if reddit_data:
            print(f"Found {len(reddit_data)} posts")
            for post in reddit_data[:3]:  # Show first 3
                print(f"  - {post.get('title')} (r/{post.get('subreddit')})")
                print(f"    Score: {post.get('score')}, Comments: {post.get('num_comments')}")
        
    except ValueError as e:
        print(f"Configuration error: {e}")
    except Exception as e:
        print(f"Error: {e}")
