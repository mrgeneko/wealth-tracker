import mysql.connector

# Update these values to match your MySQL setup
MYSQL_CONFIG = {
    'host': 'localhost',
    'user': 'test',
    'password': 'test',
    'database': 'testdb'
}

def print_table_contents(table_name):
    conn = mysql.connector.connect(**MYSQL_CONFIG)
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {table_name}")
    rows = cursor.fetchall()
    columns = [desc[0] for desc in cursor.description]
    print(f"Contents of table '{table_name}':")
    print(columns)
    for row in rows:
        print(row)
    cursor.close()
    conn.close()

if __name__ == "__main__":
    # Replace 'price_data' with the actual table name used by test_mysql_writer.py
    print_table_contents('price_data')
