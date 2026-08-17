DELETE FROM "profile"."memory_items"
WHERE "source_type" <> 'user_declared'
   OR "visibility" <> 'user_visible';--> statement-breakpoint
ALTER TABLE "profile"."memory_items" ALTER COLUMN "last_verified_at" SET DEFAULT now();
