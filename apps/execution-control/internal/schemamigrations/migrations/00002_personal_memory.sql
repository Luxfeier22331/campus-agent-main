-- +goose Up
create schema if not exists runtime;

create table if not exists runtime.personal_memory_owner_fences (
    owner_scope_hash text primary key,
    generation bigint not null,
    lifecycle_state text not null,
    last_owner_sequence bigint not null,
    updated_at timestamptz not null
);

create table if not exists runtime.personal_memory_call_leases (
    call_id text primary key,
    owner_scope_hash text not null,
    generation bigint not null,
    owner_sequence bigint not null,
    subject_scope_hash text not null,
    operation_kind text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create table if not exists runtime.personal_memory_command_receipts (
    command_id text primary key,
    owner_scope_hash text not null,
    generation bigint not null,
    sequence bigint not null,
    kind text not null,
    status text not null,
    error_code text not null default '',
    lease_expires_at timestamptz,
    result_fingerprint text not null default '',
    subject_scope_hash text not null,
    supersession_scope text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    terminal_at timestamptz,
    unique (owner_scope_hash, sequence)
);

alter table runtime.personal_memory_command_receipts
add column if not exists supersession_scope text not null default '';
alter table runtime.personal_memory_command_receipts
add column if not exists result_fingerprint text not null default '';
