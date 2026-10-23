ALTER TABLE execution_control.personal_memory_call_leases
ALTER COLUMN expires_at DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE execution_control.personal_memory_call_leases
ADD CONSTRAINT personal_memory_call_leases_durable_append_check
CHECK (expires_at IS NOT NULL OR operation_kind = 'append');
