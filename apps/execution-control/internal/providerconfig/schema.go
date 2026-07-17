package providerconfig

const SchemaSQL = `
create schema if not exists execution_config;

create table if not exists execution_config.connection_revisions (
	connection_id text not null,
	revision bigint not null,
	provider text not null,
	base_url text not null,
	features_json jsonb not null,
	feature_config_json jsonb not null default '{}'::jsonb,
	secret_key_id text not null,
	secret_nonce bytea not null,
	secret_ciphertext bytea not null,
	secret_fingerprint text not null,
	secret_last4 text not null,
	created_at timestamptz not null,
	created_by text not null,
	primary key (connection_id, revision)
);

create table if not exists execution_config.profiles (
	profile_id text primary key,
	role text not null check (role in ('primary_agent','rag_query_embedding','rag_reranker')),
	kind text not null check (kind in ('prompt','embedding','rerank')),
	connection_id text not null,
	connection_revision bigint not null,
	model text not null,
	transport text not null,
	dimensions integer,
	timeout_ms integer not null check (timeout_ms > 0),
	created_at timestamptz not null,
	created_by text not null,
	foreign key (connection_id, connection_revision)
		references execution_config.connection_revisions(connection_id, revision)
);

create table if not exists execution_config.profile_validations (
	validation_id text primary key,
	profile_id text not null references execution_config.profiles(profile_id),
	status text not null check (status in ('passed','failed')),
	error_code text not null default '',
	message text not null,
	observed_dimensions integer,
	validated_at timestamptz not null,
	validated_by text not null
);

create index if not exists provider_profile_validations_latest_idx
	on execution_config.profile_validations(profile_id, validated_at desc);

create table if not exists execution_config.activation_bundles (
	bundle_id text primary key,
	revision bigint not null unique,
	profiles_json jsonb not null,
	activated_at timestamptz not null,
	activated_by text not null
);

create table if not exists execution_config.active_bundle (
	singleton boolean primary key default true check (singleton),
	bundle_id text not null references execution_config.activation_bundles(bundle_id),
	revision bigint not null,
	updated_at timestamptz not null
);

create table if not exists execution_config.command_receipts (
	idempotency_key text primary key,
	operation text not null,
	request_sha256 text not null,
	status_code integer not null,
	response_json jsonb not null,
	created_at timestamptz not null
);

create table if not exists execution_config.audit_events (
	event_id text primary key,
	event_type text not null,
	actor_id text not null,
	target_id text not null,
	details_json jsonb not null default '{}'::jsonb,
	occurred_at timestamptz not null
);

create index if not exists provider_audit_events_occurred_idx
	on execution_config.audit_events(occurred_at desc);
`

const GrantSQL = `
revoke all privileges on schema execution_config from execution_provider_config_reader, execution_provider_config_admin;
revoke all privileges on all tables in schema execution_config from execution_provider_config_reader, execution_provider_config_admin;

grant usage on schema execution_config to execution_provider_config_reader, execution_provider_config_admin;
grant select on execution_config.connection_revisions,
	execution_config.profiles,
	execution_config.activation_bundles,
	execution_config.active_bundle
to execution_provider_config_reader;
grant select, insert, update, delete on all tables in schema execution_config
to execution_provider_config_admin;
`
