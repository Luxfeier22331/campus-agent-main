ALTER TABLE "chat"."turn_dispatches" ADD COLUMN "cancel_lease_token" text;--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" ADD COLUMN "cancel_lease_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "chat_turn_dispatches_cancel_lease_idx" ON "chat"."turn_dispatches" USING btree ("cancel_outbox_status","cancel_lease_until","updated_at");
