-- Every consumer moved to agent_control; the old role keeps only grants carried over by the
-- schema rename. CNPG can drop execution_control only after nothing references it.
REVOKE ALL ON ALL TABLES IN SCHEMA agent_control FROM execution_control;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA agent_control FROM execution_control;
REVOKE ALL ON TABLE campus_docs_serving.current_index FROM execution_control;
REVOKE ALL ON SCHEMA agent_control, campus_docs_serving, runtime FROM execution_control;
DO $$
BEGIN
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM execution_control', current_database());
END
$$;
