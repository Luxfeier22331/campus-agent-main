package providerconfig

const SchemaSQL = `
create schema if not exists execution_config;

create table if not exists execution_config.model_settings (
	kind text primary key check (kind in ('llm','embedding')),
	provider text not null,
	base_url text not null,
	model text not null,
	transport text not null,
	dimensions integer,
	secret_key_id text not null,
	secret_nonce bytea not null,
	secret_ciphertext bytea not null,
	secret_fingerprint text not null,
	secret_last4 text not null,
	validation_status text not null check (validation_status in ('passed','failed')),
	validation_error_code text not null default '',
	validation_message text not null default '',
	validation_observed_dimensions integer,
	validated_at timestamptz not null,
	validated_by text not null,
	updated_at timestamptz not null,
	updated_by text not null
);

alter table execution_config.model_settings drop column if exists timeout_ms;

`

const GrantSQL = `
revoke all privileges on execution_config.model_settings from execution_provider_config_reader, execution_provider_config_admin;

grant usage on schema execution_config to execution_provider_config_reader, execution_provider_config_admin;
grant select on execution_config.model_settings to execution_provider_config_reader;
grant select, insert, update, delete on execution_config.model_settings to execution_provider_config_admin;
`
