ALTER TABLE execution_control.personal_memory_command_receipts
DROP COLUMN result_fingerprint;
--> statement-breakpoint
ALTER TABLE profile.memory_commands
DROP COLUMN result_fingerprint;
