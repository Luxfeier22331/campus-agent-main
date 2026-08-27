ALTER TABLE "chat"."conversations" RENAME COLUMN "active_run_id" TO "active_request_id";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP CONSTRAINT "chat_turn_dispatches_input_lifecycle_check";--> statement-breakpoint
DROP INDEX "chat"."chat_messages_run_id_idx";--> statement-breakpoint
DROP INDEX "chat"."chat_turn_dispatches_run_id_uidx";--> statement-breakpoint
DROP INDEX "chat"."chat_turn_dispatches_trace_id_created_at_idx";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "trace_id";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "workflow_trace_summary_json";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "prompt_id";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "prompt_version";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "template_sha256";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "trace_available";--> statement-breakpoint
ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN "projection_lag_ms";--> statement-breakpoint
ALTER TABLE "chat"."messages" DROP COLUMN "run_id";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "trace_id";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "run_id";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN "turn_id";--> statement-breakpoint
ALTER TABLE "profile"."memory_commands" DROP COLUMN "workflow_id";--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD CONSTRAINT "chat_turn_dispatches_input_lifecycle_check" CHECK ((
					"chat"."turn_dispatches"."status" = 'accepted'
					and (
						"chat"."turn_dispatches"."execution_input_json" is not null
						and "chat"."turn_dispatches"."execution_input_sha256" is not null
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
					and (
						(
							"chat"."turn_dispatches"."execution_input_json" is null
							and "chat"."turn_dispatches"."execution_input_sha256" is null
						)
						or (
							"chat"."turn_dispatches"."execution_input_json" is not null
							and "chat"."turn_dispatches"."execution_input_sha256" is not null
						)
					)
				));
