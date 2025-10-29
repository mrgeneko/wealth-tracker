from unittest.mock import Mock, patch


def test_write_price_data_to_mysql_inserts_and_closes():
    from scrapeman.write_price_data_to_mysql import write_price_data_to_mysql

    # Prepare mock cursor and connection
    mock_cursor = Mock()
    mock_conn = Mock()
    mock_conn.cursor.return_value = mock_cursor
    mock_conn.is_connected.return_value = True

    with patch("scrapeman.write_price_data_to_mysql.mysql.connector.connect", return_value=mock_conn):
        rows = [{"k": "MYSQL-TEST-1", "last_price": "10.01", "source": "e2e-test"}]
        write_price_data_to_mysql(rows, "host", "user", "pw", "db", "price_data_test2")

    # Verify an INSERT was executed
    assert mock_cursor.execute.call_count == 1
    sql, params = mock_cursor.execute.call_args[0]
    assert "INSERT INTO `price_data_test2`" in sql
    assert params == ("MYSQL-TEST-1", "10.01", "e2e-test")

    # Verify commit and closes
    mock_conn.commit.assert_called_once()
    mock_cursor.close.assert_called_once()
    mock_conn.close.assert_called_once()
