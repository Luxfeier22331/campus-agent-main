-- +goose Up
alter table execution_control.model_settings add column embedding_space_id text;

create schema campus_docs_serving;

create table campus_docs_serving.current_index (
    singleton boolean primary key default true check (singleton),
    collection text not null check (collection ~ '^campus_docs_[a-f0-9]{64}$'),
    dense_vector_name text not null,
    embedding_dimensions integer not null check (embedding_dimensions > 0),
    embedding_model text not null,
    embedding_provider text not null,
    embedding_query_instruction text not null,
    embedding_space_id text not null,
    sparse_model text not null,
    sparse_vector_name text not null
);

-- +goose Down
drop table campus_docs_serving.current_index;
drop schema campus_docs_serving;

alter table execution_control.model_settings drop column embedding_space_id;
