CREATE TABLE execution_control.agent_runtime_payloads (
    request_id text NOT NULL REFERENCES execution_control.agent_runs (request_id) ON DELETE CASCADE,
    payload_ref text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (request_id, payload_ref)
);
GRANT SELECT, INSERT, DELETE ON execution_control.agent_runtime_payloads TO execution_control;

CREATE TABLE execution_control.agent_memory_deliveries (
    request_id text PRIMARY KEY REFERENCES execution_control.agent_runs (
        request_id
    ) ON DELETE CASCADE,
    owner_user_id text NOT NULL,
    payload jsonb,
    status text NOT NULL CHECK (status IN ('prepared', 'ready', 'delivered')),
    created_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz
);
CREATE INDEX agent_memory_delivery_ready ON execution_control.agent_memory_deliveries (
    created_at
) WHERE status
= 'ready';
GRANT SELECT,
INSERT,
UPDATE,
DELETE ON execution_control.agent_memory_deliveries TO execution_control;
