ALTER TABLE "observability"."replay_packet_index"
ADD COLUMN "answer_eval_fingerprint_json" jsonb;
--> statement-breakpoint
ALTER TABLE "observability"."replay_packet_index"
ADD COLUMN "sink_identity_projection_json" jsonb;
