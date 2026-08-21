-- +goose Up
alter table campus_docs_serving.current_index
drop column dense_vector_name,
drop column embedding_dimensions,
drop column embedding_query_instruction,
drop column embedding_space_id,
drop column sparse_model,
drop column sparse_vector_name;

-- +goose StatementBegin
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'campus_docs_index_publisher') then
        revoke all privileges on table campus_docs_serving.current_index
            from campus_docs_index_publisher;
        revoke all privileges on schema campus_docs_serving
            from campus_docs_index_publisher;
    end if;
end
$$;
-- +goose StatementEnd

-- +goose Down
alter table campus_docs_serving.current_index
add column dense_vector_name text not null default 'dense',
add column embedding_dimensions integer not null default 2560 check (embedding_dimensions > 0),
add column embedding_query_instruction text not null default
'Given a Campus Web document question, retrieve relevant current passages that '
'answer the query.',
add column embedding_space_id text not null default 'qwen3-embedding-4b@2560-v1',
add column sparse_model text not null default 'fnv1a_log_tf.v1',
add column sparse_vector_name text not null default 'sparse';

alter table campus_docs_serving.current_index
alter column dense_vector_name drop default,
alter column embedding_dimensions drop default,
alter column embedding_query_instruction drop default,
alter column embedding_space_id drop default,
alter column sparse_model drop default,
alter column sparse_vector_name drop default;
