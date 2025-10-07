import mysql.connector
from mysql.connector import Error

def write_price_data_to_mysql(price_data, host, user, password, database, table_name):
    """
    Writes a list of price data dictionaries to a MySQL table.
    Each dictionary should have keys matching the table columns.
    """
    try:
        connection = mysql.connector.connect(
            host=host,
            user=user,
            password=password,
            database=database
        )
        cursor = connection.cursor()
        for row in price_data:
            columns = ', '.join(row.keys())
            placeholders = ', '.join(['%s'] * len(row))
            sql = f"INSERT INTO {table_name} ({columns}) VALUES ({placeholders})"
            cursor.execute(sql, tuple(row.values()))
        connection.commit()
    except Error as e:
        print(f"Error: {e}")
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'connection' in locals() and connection.is_connected():
            connection.close()
