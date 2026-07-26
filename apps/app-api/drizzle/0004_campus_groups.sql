CREATE SCHEMA "campus_groups";
--> statement-breakpoint
CREATE TABLE "campus_groups"."sections" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "campus_groups_sections_position_check" CHECK ("campus_groups"."sections"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "campus_groups"."groups" (
	"id" text PRIMARY KEY NOT NULL,
	"join_url" text,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"qq_group_number" text,
	"section_id" text NOT NULL,
	"summary" text NOT NULL,
	"tags" text[] NOT NULL,
	CONSTRAINT "campus_groups_groups_position_check" CHECK ("campus_groups"."groups"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "campus_groups"."groups" ADD CONSTRAINT "groups_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "campus_groups"."sections"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "campus_groups_sections_name_uidx" ON "campus_groups"."sections" USING btree ("name");
--> statement-breakpoint
CREATE UNIQUE INDEX "campus_groups_sections_position_uidx" ON "campus_groups"."sections" USING btree ("position");
--> statement-breakpoint
CREATE UNIQUE INDEX "campus_groups_groups_qq_group_number_uidx" ON "campus_groups"."groups" USING btree ("qq_group_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "campus_groups_groups_section_position_uidx" ON "campus_groups"."groups" USING btree ("section_id","position");
