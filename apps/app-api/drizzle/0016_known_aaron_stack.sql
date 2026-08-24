ALTER TABLE "chat"."turn_dispatches" DROP CONSTRAINT "chat_turn_dispatches_input_lifecycle_check";--> statement-breakpoint
UPDATE "chat"."turn_dispatches"
SET "status" = 'completed'
WHERE "status" IN ('needs_clarification', 'no_answer');--> statement-breakpoint
UPDATE "chat"."messages"
SET "kind" = 'answer'
WHERE "role" = 'assistant' AND "kind" IN ('clarification', 'no_answer');--> statement-breakpoint
UPDATE "runtime"."request_observability_fact"
SET "status" = 'completed', "fail_closed" = false
WHERE "status" IN ('needs_clarification', 'no_answer');--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "refusal_class";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "semantic_outcome";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD CONSTRAINT "chat_turn_dispatches_input_lifecycle_check" CHECK ((
					"chat"."turn_dispatches"."status" = 'accepted'
					and "chat"."turn_dispatches"."run_id" is not null
					and "chat"."turn_dispatches"."workflow_id" is not null
					and (
						(
							"chat"."turn_dispatches"."admission_status" in ('pending_admission', 'dispatching')
							and "chat"."turn_dispatches"."admission_input_json" is not null
							and "chat"."turn_dispatches"."admission_input_sha256" is not null
							and "chat"."turn_dispatches"."execution_input_json" is not null
							and "chat"."turn_dispatches"."execution_input_sha256" is not null
						)
						or (
							"chat"."turn_dispatches"."admission_status" = 'admitted'
							and "chat"."turn_dispatches"."admission_input_json" is null
							and "chat"."turn_dispatches"."admission_input_sha256" is null
							and "chat"."turn_dispatches"."execution_input_json" is not null
							and "chat"."turn_dispatches"."execution_input_sha256" is not null
						)
						or (
							"chat"."turn_dispatches"."admission_status" = 'cancelled'
							and "chat"."turn_dispatches"."cancel_outbox_status" = 'local_finalization_pending'
							and "chat"."turn_dispatches"."admission_input_json" is null
							and "chat"."turn_dispatches"."admission_input_sha256" is null
							and "chat"."turn_dispatches"."execution_input_json" is not null
							and "chat"."turn_dispatches"."execution_input_sha256" is not null
						)
					)
				)
				or (
					"chat"."turn_dispatches"."status" in (
						'completed',
						'error',
						'approval_required',
						'rejected',
						'cancelled'
					)
					and "chat"."turn_dispatches"."admission_input_json" is null
					and "chat"."turn_dispatches"."admission_input_sha256" is null
					and (
						(
							"chat"."turn_dispatches"."run_id" is null
							and "chat"."turn_dispatches"."workflow_id" is null
							and "chat"."turn_dispatches"."execution_input_json" is null
							and "chat"."turn_dispatches"."execution_input_sha256" is null
						)
						or (
							"chat"."turn_dispatches"."run_id" is not null
							and "chat"."turn_dispatches"."workflow_id" is not null
							and "chat"."turn_dispatches"."execution_input_json" is not null
							and "chat"."turn_dispatches"."execution_input_sha256" is not null
						)
					)
				));
