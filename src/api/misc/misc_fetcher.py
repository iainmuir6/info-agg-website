"""
Miscellaneous API Script
Fetches various miscellaneous data
"""

import os
import requests
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

def fetch_weather_data():
    """Fetch weather data from OpenWeatherMap API"""
    api_key = os.getenv('OPENWEATHER_API_KEY')
    if not api_key:
        print("OPENWEATHER_API_KEY not found")
        return None
    
    # Example: Get weather for New York
    url = "https://api.openweathermap.org/data/2.5/weather"
    params = {
        'q': 'New York,US',
        'appid': api_key,
        'units': 'metric'
    }
    
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        
        return {
            'city': data.get('name'),
            'country': data.get('sys', {}).get('country'),
            'temperature': data.get('main', {}).get('temp'),
            'feels_like': data.get('main', {}).get('feels_like'),
            'humidity': data.get('main', {}).get('humidity'),
            'description': data.get('weather', [{}])[0].get('description'),
            'wind_speed': data.get('wind', {}).get('speed'),
            'timestamp': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching weather data: {e}")
        return None


def fetch_random_fact():
    """Fetch random facts from various APIs"""
    # Using a free random facts API
    url = "https://uselessfacts.jsph.pl/random.json?language=en"
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        
        return {
            'fact': data.get('text'),
            'source': data.get('source'),
            'timestamp': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching random fact: {e}")
        return None


def fetch_quote_of_the_day():
    """Fetch inspirational quotes"""
    # Using quotable API
    url = "https://api.quotable.io/random"
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        
        return {
            'content': data.get('content'),
            'author': data.get('author'),
            'tags': data.get('tags', []),
            'timestamp': datetime.now().isoformat()
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching quote: {e}")
        return None


def fetch_calendar_events():
    """Fetch calendar events and holidays"""
    # Using a free holidays API
    current_year = datetime.now().year
    url = f"https://date.nager.at/api/v3/PublicHolidays/{current_year}/US"
    
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        
        # Filter upcoming holidays
        today = datetime.now().date()
        upcoming_holidays = []
        
        for holiday in data:
            holiday_date = datetime.fromisoformat(holiday['date']).date()
            if holiday_date >= today:
                upcoming_holidays.append({
                    'name': holiday['name'],
                    'date': holiday['date'],
                    'local_name': holiday.get('localName'),
                    'country_code': holiday.get('countryCode')
                })
        
        return upcoming_holidays[:5]  # Return next 5 holidays
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching calendar events: {e}")
        return None


if __name__ == "__main__":
    print("Fetching miscellaneous data...")
    
    # Fetch weather data
    weather_data = fetch_weather_data()
    if weather_data:
        print(f"\nWeather in {weather_data['city']}, {weather_data['country']}:")
        print(f"- Temperature: {weather_data['temperature']}°C")
        print(f"- Description: {weather_data['description']}")
        print(f"- Humidity: {weather_data['humidity']}%")
    
    # Fetch random fact
    fact_data = fetch_random_fact()
    if fact_data:
        print(f"\nRandom Fact:")
        print(f"- {fact_data['fact']}")
    
    # Fetch quote
    quote_data = fetch_quote_of_the_day()
    if quote_data:
        print(f"\nQuote of the Day:")
        print(f"- \"{quote_data['content']}\" - {quote_data['author']}")
    
    # Fetch calendar events
    calendar_data = fetch_calendar_events()
    if calendar_data:
        print(f"\nUpcoming Holidays:")
        for holiday in calendar_data:
            print(f"- {holiday['name']} on {holiday['date']}")
