CREATE SCHEMA memory;

CREATE TABLE memory.personal_memory_owner_fences (
    owner_scope_hash text PRIMARY KEY,
    generation bigint NOT NULL,
    lifecycle_state text NOT NULL,
    last_owner_sequence bigint NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE TABLE memory.personal_memory_call_leases (
    call_id text PRIMARY KEY,
    owner_scope_hash text NOT NULL,
    generation bigint NOT NULL,
    operation_kind text NOT NULL,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at IS NOT NULL OR operation_kind = 'append')
);
CREATE INDEX memory_call_owner_generation ON memory.personal_memory_call_leases (
    owner_scope_hash, generation
);
CREATE TABLE memory.personal_memory_command_receipts (
    command_id text PRIMARY KEY,
    owner_scope_hash text NOT NULL,
    generation bigint NOT NULL,
    sequence bigint NOT NULL,
    kind text NOT NULL,
    status text NOT NULL,
    error_code text NOT NULL DEFAULT '',
    lease_expires_at timestamptz,
    subject_scope_hash text NOT NULL,
    supersession_scope text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    terminal_at timestamptz,
    UNIQUE (owner_scope_hash, sequence)
);
CREATE TABLE memory.requests (
    command_id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('command', 'append')),
    owner_scope_hash text NOT NULL,
    input_sha256 text NOT NULL,
    payload jsonb,
    status text NOT NULL CHECK (
        status IN (
            'accepted',
            'running',
            'processing',
            'unknown',
            'succeeded',
            'completed',
            'failed',
            'skipped'
        )
    ),
    result jsonb,
    dispatched boolean NOT NULL DEFAULT FALSE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_requests_dispatch ON memory.requests (
    created_at, command_id
) WHERE NOT dispatched;
CREATE INDEX memory_requests_owner ON memory.requests (owner_scope_hash);
