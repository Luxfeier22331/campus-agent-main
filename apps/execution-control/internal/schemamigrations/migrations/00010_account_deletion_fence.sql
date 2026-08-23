-- +goose Up
create table execution_control.owner_deletion_fences (
    owner_user_id text primary key,
    state text not null
    constraint owner_deletion_fences_state_check
    check (state in ('draining', 'deleted')),
    started_at timestamptz not null,
    deleted_at timestamptz
);

create index owner_deletion_fences_state_idx
on execution_control.owner_deletion_fences (state, started_at);

-- +goose Down
drop table execution_control.owner_deletion_fences;
