import json
import unittest
from copy import deepcopy
from unittest.mock import MagicMock, patch

from campus_agent.config import CampusAgentSettings
from campus_agent.state.models import (
    ToolExecutionRecord,
    WorkflowActorContext,
    WorkflowState,
    WorkflowTraceContext,
)
from campus_agent.state.store import WorkflowStateStore


def _sample_state(
    *,
    workflow_run_id: str = "wf-pg-001",
    navigation_mode: str | None = "walking",
) -> WorkflowState:
    return WorkflowState(
        conversation_id="conv-pg-001",
        workflow_run_id=workflow_run_id,
        user_query="map: student center",
        intent="map_resolve",
        selected_tool="campus_map_resolve",
        tool_results=[
            ToolExecutionRecord(
                tool_name="campus_map_resolve",
                tool_call_id="tool-call-pg-001",
                request={"query": "student center"},
                response={"ok": True, "data": {"status": "resolved"}},
                status="completed",
            ),
        ],
        final_answer="Resolved.",
        navigation_mode=navigation_mode,
        pending_confirmation=False,
        trace=WorkflowTraceContext(
            trace_id="trace-pg-001",
            parent_run_id="run-parent-pg-001",
            tool_call_id="tool-call-pg-001",
        ),
        actor_context=WorkflowActorContext(
            user_id="user-pg",
            roles=("student",),
            campus_scope="north-campus",
        ),
        actor_snapshot={"actor_user_id": "user-pg", "is_authenticated": True},
        status="completed",
        last_completed_step="compose_final_answer",
        resume_token="wf-pg-001",
        hitl_context={},
        extension_state={"workflow_engine": "agno_workflow_first"},
    )


def _make_store_with_mock(mock_conn: MagicMock):
    """Create a PostgresWorkflowStateStore with mocked psycopg."""
    mock_psycopg = MagicMock()
    mock_psycopg.connect.return_value = mock_conn
    mock_conn.closed = False

    with patch.dict("sys.modules", {"psycopg": mock_psycopg}):
        import importlib
        import campus_agent.state.postgres_store as pg_mod
        importlib.reload(pg_mod)
        store = pg_mod.PostgresWorkflowStateStore(
            conninfo="postgresql://test:test@localhost/test",
        )

    return store


class PostgresWorkflowStateStoreProtocolTest(unittest.TestCase):
    """Verify PostgresWorkflowStateStore satisfies WorkflowStateStore Protocol."""

    def test_implements_workflow_state_store_protocol(self) -> None:
        mock_conn = MagicMock()
        mock_conn.closed = False
        store = _make_store_with_mock(mock_conn)

        self.assertTrue(hasattr(store, "save"))
        self.assertTrue(hasattr(store, "load"))
        self.assertTrue(callable(store.save))
        self.assertTrue(callable(store.load))

        # Structural subtype check: can be assigned where Protocol is expected
        def _accept_store(s: WorkflowStateStore) -> None:
            pass

        _accept_store(store)  # type: ignore[arg-type]


class PostgresWorkflowStateStoreTest(unittest.TestCase):
    """Tests for PostgresWorkflowStateStore using mocked psycopg connection."""

    def test_save_executes_upsert_with_serialized_state_json(self) -> None:
        mock_conn = MagicMock()
        mock_conn.closed = False
        store = _make_store_with_mock(mock_conn)

        state = _sample_state()
        store.save(state)

        calls = mock_conn.execute.call_args_list
        self.assertEqual(len(calls), 1)
        upsert_args = calls[0][0]
        self.assertIn("INSERT INTO workflow_states", upsert_args[0])
        self.assertIn("state_json", upsert_args[0])
        params = upsert_args[1]
        self.assertEqual(params[0], "wf-pg-001")
        payload = json.loads(params[1])
        self.assertEqual(payload["workflow_run_id"], "wf-pg-001")
        self.assertEqual(payload["navigation_mode"], "walking")

    def test_load_returns_deserialized_state_from_json_dict(self) -> None:
        state = _sample_state()
        state_dict = deepcopy(state.to_dict())

        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (state_dict,)
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.execute.return_value = mock_cursor
        store = _make_store_with_mock(mock_conn)

        loaded = store.load("wf-pg-001")

        self.assertEqual(loaded.workflow_run_id, "wf-pg-001")
        self.assertEqual(loaded.conversation_id, "conv-pg-001")
        self.assertEqual(loaded.navigation_mode, "walking")
        self.assertEqual(loaded.status, "completed")
        self.assertEqual(loaded.tool_results[0].tool_name, "campus_map_resolve")

    def test_load_returns_deserialized_state_from_json_string(self) -> None:
        state = _sample_state()
        state_json = json.dumps(state.to_dict())

        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (state_json,)
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.execute.return_value = mock_cursor
        store = _make_store_with_mock(mock_conn)

        loaded = store.load("wf-pg-001")
        self.assertEqual(loaded.workflow_run_id, "wf-pg-001")

    def test_load_raises_key_error_for_missing_workflow(self) -> None:
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None
        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.execute.return_value = mock_cursor
        store = _make_store_with_mock(mock_conn)

        with self.assertRaises(KeyError):
            store.load("wf-missing")

    def test_create_table_if_not_exists_executes_ddl(self) -> None:
        mock_conn = MagicMock()
        mock_conn.closed = False
        store = _make_store_with_mock(mock_conn)

        store.create_table_if_not_exists()

        create_call = mock_conn.execute.call_args_list[0]
        self.assertIn("CREATE TABLE IF NOT EXISTS workflow_states", create_call[0][0])
        self.assertIn("state_json JSONB NOT NULL", create_call[0][0])

    def test_close_closes_connection(self) -> None:
        mock_conn = MagicMock()
        mock_conn.closed = False
        store = _make_store_with_mock(mock_conn)

        store._get_connection()
        store.close()

        mock_conn.close.assert_called_once()

    def test_save_load_round_trip_preserves_all_fields(self) -> None:
        state = _sample_state(navigation_mode="accessible")
        captured_payload = {}

        def capture_upsert(sql, params=None):
            if params and "INSERT" in sql:
                captured_payload["json"] = params[1]
            mock_cursor = MagicMock()
            mock_cursor.fetchone.return_value = None
            return mock_cursor

        mock_conn = MagicMock()
        mock_conn.closed = False
        mock_conn.execute.side_effect = capture_upsert
        store = _make_store_with_mock(mock_conn)

        store.save(state)

        saved_dict = json.loads(captured_payload["json"])

        def select_return(sql, params=None):
            mock_cursor = MagicMock()
            if "SELECT" in sql:
                mock_cursor.fetchone.return_value = (saved_dict,)
            return mock_cursor

        mock_conn.execute.side_effect = select_return

        loaded = store.load("wf-pg-001")
        self.assertEqual(loaded.to_dict(), state.to_dict())


class PostgresSettingsTest(unittest.TestCase):
    def test_settings_default_backend_is_in_memory(self) -> None:
        settings = CampusAgentSettings()
        self.assertEqual(settings.workflow_state_backend, "in_memory")
        self.assertIsNone(settings.postgres_conninfo)
        self.assertEqual(settings.request_context_candidate_memory_limit, 10)
        self.assertEqual(settings.request_context_emit_memory_limit, 3)

    def test_settings_from_env_reads_postgres_config(self) -> None:
        env = {
            "CAMPUS_AGENT_WORKFLOW_STATE_BACKEND": "postgres",
            "CAMPUS_AGENT_POSTGRES_CONNINFO": "postgresql://user:pass@db:5432/campus",
            "CAMPUS_AGENT_REQUEST_CONTEXT_CANDIDATE_MEMORY_LIMIT": "12",
            "CAMPUS_AGENT_REQUEST_CONTEXT_EMIT_MEMORY_LIMIT": "4",
        }
        with patch.dict("os.environ", env, clear=False):
            settings = CampusAgentSettings.from_env()
        self.assertEqual(settings.workflow_state_backend, "postgres")
        self.assertEqual(settings.postgres_conninfo, "postgresql://user:pass@db:5432/campus")
        self.assertEqual(settings.request_context_candidate_memory_limit, 12)
        self.assertEqual(settings.request_context_emit_memory_limit, 4)

    def test_settings_from_env_defaults_conninfo_to_none(self) -> None:
        with patch.dict("os.environ", {}, clear=False):
            settings = CampusAgentSettings.from_env()
        self.assertIsNone(settings.postgres_conninfo)


class CreateStateStoreFactoryTest(unittest.TestCase):
    def test_factory_returns_in_memory_store_by_default(self) -> None:
        from campus_agent.state import InMemoryWorkflowStateStore, create_state_store

        settings = CampusAgentSettings()
        store = create_state_store(settings)
        self.assertIsInstance(store, InMemoryWorkflowStateStore)

    def test_factory_returns_postgres_store_when_configured(self) -> None:
        mock_psycopg = MagicMock()
        with patch.dict("sys.modules", {"psycopg": mock_psycopg}):
            import importlib
            import campus_agent.state.postgres_store as pg_mod
            importlib.reload(pg_mod)

            from campus_agent.state import create_state_store

            settings = CampusAgentSettings(
                workflow_state_backend="postgres",
                postgres_conninfo="postgresql://test@localhost/test",
            )
            store = create_state_store(settings)
            self.assertEqual(type(store).__name__, "PostgresWorkflowStateStore")

    def test_factory_raises_when_postgres_without_conninfo(self) -> None:
        from campus_agent.state import create_state_store

        settings = CampusAgentSettings(workflow_state_backend="postgres")
        with self.assertRaises(ValueError) as ctx:
            create_state_store(settings)
        self.assertIn("CAMPUS_AGENT_POSTGRES_CONNINFO", str(ctx.exception))


class PostgresImportGuardTest(unittest.TestCase):
    def test_import_error_raised_when_psycopg_unavailable(self) -> None:
        with patch.dict("sys.modules", {"psycopg": None}):
            import importlib
            import campus_agent.state.postgres_store as pg_mod
            importlib.reload(pg_mod)
            with self.assertRaises(ImportError) as ctx:
                pg_mod.PostgresWorkflowStateStore(
                    conninfo="postgresql://test@localhost/test",
                )
            self.assertIn("psycopg is required", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
