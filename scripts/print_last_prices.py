import os
import mysql.connector
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

def get_mysql_config():
    return {
        'host': os.getenv('MYSQL_HOST', 'localhost'),
        'port': int(os.getenv('MYSQL_PORT', 3306)),
        'user': os.getenv('MYSQL_USER', 'test'),
        'password': os.getenv('MYSQL_PASSWORD', 'test'),
        'database': os.getenv('MYSQL_DATABASE', 'testdb')
    }

def print_last_prices():
    config = get_mysql_config()
    print(f"Connecting to MySQL at {config['host']}:{config['port']} as {config['user']}...")
    
    try:
        conn = mysql.connector.connect(**config)
        cursor = conn.cursor(dictionary=True)
        
        table_name = 'latest_prices'
        query = f"SELECT * FROM {table_name} ORDER BY ticker"
        
        cursor.execute(query)
        rows = cursor.fetchall()
        
        if not rows:
            print(f"No data found in table '{table_name}'.")
        else:
            # Debug: print keys of the first row
            # print(f"Columns found: {list(rows[0].keys())}")
            
            print(f"\n{'Ticker':<10} {'Price':<10} {'Timestamp':<25} {'Source':<10}")
            print("-" * 60)
            for row in rows:
                ticker = row.get('ticker', 'N/A')
                price = row.get('price', 'N/A')
                # Check for common timestamp column names
                timestamp = row.get('last_updated') or row.get('timestamp') or row.get('updated_at') or 'N/A'
                source = row.get('source', 'N/A')
                print(f"{ticker:<10} {price:<10} {str(timestamp):<25} {source:<10}")
                
        cursor.close()
        conn.close()
        
    except mysql.connector.Error as err:
        print(f"Error: {err}")

if __name__ == "__main__":
    print_last_prices()
