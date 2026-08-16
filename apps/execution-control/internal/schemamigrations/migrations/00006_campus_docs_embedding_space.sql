-- +goose Up
drop view execution_config.model_settings;

alter table execution_control.model_settings drop column if exists dimensions;
alter table execution_control.model_settings drop column embedding_space_id;
alter table campus_docs_serving.current_index drop column embedding_model;
alter table campus_docs_serving.current_index drop column embedding_provider;

create view execution_config.model_settings as
select
    kind,
    provider,
    base_url,
    model,
    transport,
    secret_key_id,
    secret_nonce,
    secret_ciphertext,
    secret_fingerprint,
    secret_last4,
    validation_status,
    validation_error_code,
    validation_message,
    validation_observed_dimensions,
    validated_at,
    validated_by,
    updated_at,
    updated_by
from execution_control.model_settings
offset 0; -- noqa: AM04

-- +goose Down
drop view execution_config.model_settings;

alter table campus_docs_serving.current_index
add column embedding_provider text not null default 'openai-compatible';
alter table campus_docs_serving.current_index
add column embedding_model text not null default 'Qwen3-Embedding-4B';

alter table campus_docs_serving.current_index alter column embedding_provider drop default;
alter table campus_docs_serving.current_index alter column embedding_model drop default;

alter table execution_control.model_settings add column embedding_space_id text;
alter table execution_control.model_settings add column dimensions integer;

create view execution_config.model_settings as
select * from execution_control.model_settings offset 0; -- noqa: AM04
