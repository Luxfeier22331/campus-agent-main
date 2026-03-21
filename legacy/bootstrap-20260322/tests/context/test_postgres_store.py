import unittest
from unittest.mock import MagicMock, patch


def _make_store_with_mock(mock_conn: MagicMock):
    mock_psycopg = MagicMock()
    mock_psycopg.connect.return_value = mock_conn
    mock_conn.closed = False

    with patch.dict("sys.modules", {"psycopg": mock_psycopg}):
        import importlib
        import campus_agent.context.postgres_store as pg_mod

        importlib.reload(pg_mod)
        store = pg_mod.PostgresContextStore(
            conninfo="postgresql://test:test@localhost/test",
        )
    return store


class PostgresContextStoreTest(unittest.TestCase):
    def test_create_tables_if_not_exists_executes_all_context_ddls(self) -> None:
        mock_conn = MagicMock()
        mock_conn.closed = False
        store = _make_store_with_mock(mock_conn)

        store.create_tables_if_not_exists()

        ddl = "\n".join(call[0][0] for call in mock_conn.execute.call_args_list)
        self.assertIn("CREATE TABLE IF NOT EXISTS user_profiles", ddl)
        self.assertIn("CREATE TABLE IF NOT EXISTS user_preferences", ddl)
        self.assertIn("CREATE TABLE IF NOT EXISTS user_memories", ddl)
        self.assertIn("CREATE TABLE IF NOT EXISTS conversation_contexts", ddl)


if __name__ == "__main__":
    unittest.main()
