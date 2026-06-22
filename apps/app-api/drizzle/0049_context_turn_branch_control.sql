ALTER TABLE "runtime"."request_execution" ADD COLUMN "turn_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "runtime_request_execution_conversation_turn_sequence_idx" ON "runtime"."request_execution" USING btree ("conversation_id","turn_sequence");
