package execution

// This query is the executable readiness manifest for schema added or changed by
// the durable run lifecycle. It intentionally inspects PostgreSQL catalogs rather
// than treating table existence as proof that an older installation is compatible.
const runProjectionSchemaHealthSQL = `
with expected_tables(table_name) as (
	values
		('agent_runs'),
		('agent_run_events'),
		('agent_run_steps'),
		('agent_step_attempts'),
		('agent_step_results'),
		('conversation_run_locks'),
		('agent_workflow_starts'),
		('agent_run_cancellations'),
		('agent_invocation_receipts')
),
actual_tables as (
	select relation.relname::text as table_name
	from pg_class as relation
	join pg_namespace as namespace on namespace.oid = relation.relnamespace
	where namespace.nspname = 'runtime'
		and relation.relkind in ('r', 'p')
),
expected_columns(table_name, column_name, data_type, not_null, default_expression) as (
	values
		('agent_runs', 'request_fingerprint_sha256', 'text', true, $$''::text$$),
		('agent_run_steps', 'activity_attempt', 'integer', true, '0'),
		('agent_step_attempts', 'activity_attempt', 'integer', true, '0'),

		('agent_workflow_starts', 'run_id', 'text', true, ''),
		('agent_workflow_starts', 'workflow_id', 'text', true, ''),
		('agent_workflow_starts', 'payload_sha256', 'text', true, ''),
		('agent_workflow_starts', 'task_queue', 'text', true, ''),
		('agent_workflow_starts', 'workflow_input_json', 'jsonb', true, ''),
		('agent_workflow_starts', 'state', 'text', true, ''),
		('agent_workflow_starts', 'temporal_run_id', 'text', true, $$''::text$$),
		('agent_workflow_starts', 'attempt_count', 'integer', true, '0'),
		('agent_workflow_starts', 'dispatch_attempted', 'boolean', true, 'false'),
		('agent_workflow_starts', 'next_attempt_at', 'timestamp with time zone', true, ''),
		('agent_workflow_starts', 'lease_token', 'text', true, $$''::text$$),
		('agent_workflow_starts', 'lease_until', 'timestamp with time zone', false, ''),
		('agent_workflow_starts', 'last_error_code', 'text', true, $$''::text$$),
		('agent_workflow_starts', 'created_at', 'timestamp with time zone', true, ''),
		('agent_workflow_starts', 'updated_at', 'timestamp with time zone', true, ''),

		('agent_run_cancellations', 'run_id', 'text', true, ''),
		('agent_run_cancellations', 'workflow_id', 'text', true, ''),
		('agent_run_cancellations', 'reason', 'text', true, ''),
		('agent_run_cancellations', 'state', 'text', true, ''),
		('agent_run_cancellations', 'attempt_count', 'integer', true, '0'),
		('agent_run_cancellations', 'next_attempt_at', 'timestamp with time zone', true, ''),
		('agent_run_cancellations', 'lease_token', 'text', true, $$''::text$$),
		('agent_run_cancellations', 'lease_until', 'timestamp with time zone', false, ''),
		('agent_run_cancellations', 'last_error_code', 'text', true, $$''::text$$),
		('agent_run_cancellations', 'created_at', 'timestamp with time zone', true, ''),
		('agent_run_cancellations', 'updated_at', 'timestamp with time zone', true, ''),

		('agent_invocation_receipts', 'invocation_id', 'text', true, ''),
		('agent_invocation_receipts', 'run_id', 'text', true, ''),
		('agent_invocation_receipts', 'input_sha256', 'text', true, ''),
		('agent_invocation_receipts', 'state', 'text', true, ''),
		('agent_invocation_receipts', 'output_json', 'jsonb', false, ''),
		('agent_invocation_receipts', 'output_sha256', 'text', true, $$''::text$$),
		('agent_invocation_receipts', 'created_at', 'timestamp with time zone', true, ''),
		('agent_invocation_receipts', 'completed_at', 'timestamp with time zone', false, ''),
		('agent_invocation_receipts', 'updated_at', 'timestamp with time zone', true, '')
),
actual_columns as (
	select
		relation.relname::text as table_name,
		attribute.attname::text as column_name,
		format_type(attribute.atttypid, attribute.atttypmod) as data_type,
		attribute.attnotnull as not_null,
		regexp_replace(
			lower(coalesce(pg_get_expr(attribute_default.adbin, attribute_default.adrelid), '')),
			'\s+',
			'',
			'g'
		) as default_expression
	from pg_class as relation
	join pg_namespace as namespace on namespace.oid = relation.relnamespace
	join pg_attribute as attribute on attribute.attrelid = relation.oid
	left join pg_attrdef as attribute_default
		on attribute_default.adrelid = relation.oid
		and attribute_default.adnum = attribute.attnum
	where namespace.nspname = 'runtime'
		and relation.relkind in ('r', 'p')
		and attribute.attnum > 0
		and not attribute.attisdropped
),
expected_constraints(
	table_name,
	constraint_type,
	columns,
	referenced_schema,
	referenced_table,
	referenced_columns,
	delete_action
) as (
		values
			('agent_run_steps', 'p', array['run_id', 'step_id']::text[], '', '', array[]::text[], ''),
			('agent_run_steps', 'f', array['run_id']::text[], 'runtime', 'agent_runs', array['run_id']::text[], 'c'),
			('agent_step_attempts', 'p', array['attempt_id']::text[], '', '', array[]::text[], ''),
			('agent_step_attempts', 'u', array['run_id', 'step_id', 'attempt']::text[], '', '', array[]::text[], ''),
			('agent_step_attempts', 'f', array['run_id']::text[], 'runtime', 'agent_runs', array['run_id']::text[], 'c'),
			('agent_step_results', 'p', array['result_id']::text[], '', '', array[]::text[], ''),
			('agent_step_results', 'f', array['run_id']::text[], 'runtime', 'agent_runs', array['run_id']::text[], 'c'),
		('agent_workflow_starts', 'p', array['run_id']::text[], '', '', array[]::text[], ''),
		('agent_workflow_starts', 'u', array['workflow_id']::text[], '', '', array[]::text[], ''),
		('agent_workflow_starts', 'f', array['run_id']::text[], 'runtime', 'agent_runs', array['run_id']::text[], 'c'),
		('agent_run_cancellations', 'p', array['run_id']::text[], '', '', array[]::text[], ''),
		('agent_run_cancellations', 'f', array['run_id']::text[], 'runtime', 'agent_runs', array['run_id']::text[], 'c'),
		('agent_invocation_receipts', 'p', array['invocation_id']::text[], '', '', array[]::text[], ''),
		('agent_invocation_receipts', 'f', array['run_id']::text[], 'runtime', 'agent_runs', array['run_id']::text[], 'c')
),
actual_constraints as (
	select
		relation.relname::text as table_name,
		constraint_metadata.contype::text as constraint_type,
		array(
			select attribute.attname::text
			from unnest(constraint_metadata.conkey) with ordinality as constraint_key(attnum, ordinality)
			join pg_attribute as attribute
				on attribute.attrelid = constraint_metadata.conrelid
				and attribute.attnum = constraint_key.attnum
			order by constraint_key.ordinality
		) as columns,
		coalesce(referenced_namespace.nspname::text, '') as referenced_schema,
		coalesce(referenced_relation.relname::text, '') as referenced_table,
		case
			when constraint_metadata.contype = 'f' then array(
				select attribute.attname::text
				from unnest(constraint_metadata.confkey) with ordinality as constraint_key(attnum, ordinality)
				join pg_attribute as attribute
					on attribute.attrelid = constraint_metadata.confrelid
					and attribute.attnum = constraint_key.attnum
				order by constraint_key.ordinality
			)
			else array[]::text[]
		end as referenced_columns,
		case when constraint_metadata.contype = 'f' then constraint_metadata.confdeltype::text else '' end as delete_action
	from pg_constraint as constraint_metadata
	join pg_class as relation on relation.oid = constraint_metadata.conrelid
	join pg_namespace as namespace on namespace.oid = relation.relnamespace
	left join pg_class as referenced_relation on referenced_relation.oid = constraint_metadata.confrelid
	left join pg_namespace as referenced_namespace on referenced_namespace.oid = referenced_relation.relnamespace
	where namespace.nspname = 'runtime'
		and constraint_metadata.convalidated
),
expected_indexes(table_name, index_name, unique_index, columns, method, predicate) as (
	values
		(
			'agent_runs',
			'agent_runs_active_conversation_idx',
			true,
			array['conversation_id']::text[],
			'btree',
			$$status=anyarray['created'::text,'queued'::text,'admitted'::text,'running'::text,'streaming'::text]$$
		),
		('agent_workflow_starts', 'agent_workflow_starts_lease_idx', false, array['state', 'next_attempt_at', 'lease_until']::text[], 'btree', ''),
		('agent_run_cancellations', 'agent_run_cancellations_lease_idx', false, array['state', 'next_attempt_at', 'lease_until']::text[], 'btree', ''),
		('agent_invocation_receipts', 'agent_invocation_receipts_run_idx', false, array['run_id', 'created_at']::text[], 'btree', '')
),
actual_indexes as (
	select
		relation.relname::text as table_name,
		index_relation.relname::text as index_name,
		index_metadata.indisunique as unique_index,
		array(
			select pg_get_indexdef(index_metadata.indexrelid, key_position, true)
			from generate_series(1, index_metadata.indnkeyatts::integer) as key_position
			order by key_position
		) as columns,
		access_method.amname::text as method,
		translate(
			regexp_replace(
				lower(coalesce(pg_get_expr(index_metadata.indpred, index_metadata.indrelid), '')),
				'\s+',
				'',
				'g'
			),
			'()',
			''
		) as predicate
	from pg_index as index_metadata
	join pg_class as relation on relation.oid = index_metadata.indrelid
	join pg_namespace as namespace on namespace.oid = relation.relnamespace
	join pg_class as index_relation on index_relation.oid = index_metadata.indexrelid
	join pg_namespace as index_namespace on index_namespace.oid = index_relation.relnamespace
	join pg_am as access_method on access_method.oid = index_relation.relam
	where namespace.nspname = 'runtime'
		and index_namespace.nspname = 'runtime'
		and index_metadata.indisvalid
		and index_metadata.indisready
		and index_metadata.indnatts = index_metadata.indnkeyatts
),
schema_issues(issue) as (
	select format('table runtime.%I is missing', expected.table_name)
	from expected_tables as expected
	where not exists (
		select 1 from actual_tables as actual where actual.table_name = expected.table_name
	)

	union all

	select format(
		'column runtime.%I.%I does not match required type, nullability, or default',
		expected.table_name,
		expected.column_name
	)
	from expected_columns as expected
	where exists (
		select 1 from actual_tables as actual where actual.table_name = expected.table_name
	)
		and not exists (
			select 1
			from actual_columns as actual
			where actual.table_name = expected.table_name
				and actual.column_name = expected.column_name
				and actual.data_type = expected.data_type
				and actual.not_null = expected.not_null
				and actual.default_expression = expected.default_expression
		)

	union all

	select format(
		'constraint runtime.%I (%s %s) is missing or invalid',
		expected.table_name,
		expected.constraint_type,
		array_to_string(expected.columns, ',')
	)
	from expected_constraints as expected
	where exists (
		select 1 from actual_tables as actual where actual.table_name = expected.table_name
	)
		and not exists (
			select 1
			from actual_constraints as actual
			where actual.table_name = expected.table_name
				and actual.constraint_type = expected.constraint_type
				and actual.columns = expected.columns
				and actual.referenced_schema = expected.referenced_schema
				and actual.referenced_table = expected.referenced_table
				and actual.referenced_columns = expected.referenced_columns
				and actual.delete_action = expected.delete_action
		)

	union all

	select format('index runtime.%I is missing or has the wrong definition', expected.index_name)
	from expected_indexes as expected
	where exists (
		select 1 from actual_tables as actual where actual.table_name = expected.table_name
	)
		and not exists (
			select 1
			from actual_indexes as actual
			where actual.table_name = expected.table_name
				and actual.index_name = expected.index_name
				and actual.unique_index = expected.unique_index
				and actual.columns = expected.columns
				and actual.method = expected.method
				and actual.predicate = expected.predicate
		)
)
select issue
from schema_issues
order by issue
`
