"""
Markets API Script
Fetches financial market data from various sources
"""

import os
import requests
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

def fetch_alpha_vantage_data():
    """Fetch stock data from Alpha Vantage API"""
    api_key = os.getenv('ALPHA_VANTAGE_API_KEY')
    if not api_key:
        print("ALPHA_VANTAGE_API_KEY not found")
        return None
    
    # Example: Get quote for Apple stock
    url = "https://www.alphavantage.co/query"
    params = {
        'function': 'GLOBAL_QUOTE',
        'symbol': 'AAPL',
        'apikey': api_key
    }
    
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        
        quote = data.get('Global Quote', {})
        if quote:
            return {
                'symbol': quote.get('01. symbol'),
                'price': quote.get('05. price'),
                'change': quote.get('09. change'),
                'change_percent': quote.get('10. change percent'),
                'volume': quote.get('06. volume'),
                'last_trading_day': quote.get('07. latest trading day')
            }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching Alpha Vantage data: {e}")
        return None

def fetch_crypto_data():
    """Fetch cryptocurrency data"""
    api_key = os.getenv('COINMARKETCAP_API_KEY')
    if not api_key:
        print("COINMARKETCAP_API_KEY not found")
        return None
    
    url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest"
    headers = {
        'Accepts': 'application/json',
        'X-CMC_PRO_API_KEY': api_key
    }
    
    # Get top cryptocurrencies
    symbols = 'BTC,ETH,BNB,ADA,SOL'
    params = {'symbol': symbols}
    
    try:
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()
        
        crypto_data = []
        for symbol, info in data.get('data', {}).items():
            quote = info.get('quote', {}).get('USD', {})
            crypto_data.append({
                'symbol': symbol,
                'name': info.get('name'),
                'price': quote.get('price'),
                'market_cap': quote.get('market_cap'),
                'volume_24h': quote.get('volume_24h'),
                'percent_change_24h': quote.get('percent_change_24h')
            })
        
        return crypto_data
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching crypto data: {e}")
        return None

def fetch_forex_data():
    """Fetch foreign exchange data"""
    api_key = os.getenv('ALPHA_VANTAGE_API_KEY')
    if not api_key:
        print("ALPHA_VANTAGE_API_KEY not found")
        return None
    
    url = "https://www.alphavantage.co/query"
    params = {
        'function': 'CURRENCY_EXCHANGE_RATE',
        'from_currency': 'USD',
        'to_currency': 'EUR',
        'apikey': api_key
    }
    
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        
        exchange_rate = data.get('Realtime Currency Exchange Rate', {})
        if exchange_rate:
            return {
                'from_currency': exchange_rate.get('1. From_Currency Code'),
                'to_currency': exchange_rate.get('3. To_Currency Code'),
                'exchange_rate': exchange_rate.get('5. Exchange Rate'),
                'last_refreshed': exchange_rate.get('6. Last Refreshed')
            }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching forex data: {e}")
        return None

if __name__ == "__main__":
    print("Fetching market data...")
    
    # Fetch stock data
    stock_data = fetch_alpha_vantage_data()
    if stock_data:
        print(f"\nStock Data:")
        print(f"- {stock_data['symbol']}: ${stock_data['price']} ({stock_data['change_percent']})")
    
    # Fetch crypto data
    crypto_data = fetch_crypto_data()
    if crypto_data:
        print(f"\nCryptocurrency Data:")
        for crypto in crypto_data[:3]:  # Show first 3
            print(f"- {crypto['symbol']}: ${crypto['price']:.2f} ({crypto['percent_change_24h']:.2f}%)")
    
    # Fetch forex data
    forex_data = fetch_forex_data()
    if forex_data:
        print(f"\nForex Data:")
        print(f"- {forex_data['from_currency']}/{forex_data['to_currency']}: {forex_data['exchange_rate']}")
