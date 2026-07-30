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
grant usage on schema execution_config to execution_control;
grant select, insert, update, delete on execution_config.model_settings to execution_control;

do $$
begin
	if exists (select 1 from pg_roles where rolname = 'execution_provider_config_reader') then
		revoke all privileges on execution_config.model_settings from execution_provider_config_reader;
		revoke usage on schema execution_config from execution_provider_config_reader;
	end if;
	if exists (select 1 from pg_roles where rolname = 'execution_provider_config_admin') then
		revoke all privileges on execution_config.model_settings from execution_provider_config_admin;
		revoke usage on schema execution_config from execution_provider_config_admin;
	end if;
end
$$;
`
