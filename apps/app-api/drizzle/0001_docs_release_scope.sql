ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "resolved_targets_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN IF EXISTS "requested_scope";
--> statement-breakpoint
ALTER TABLE "chat"."turn_dispatches" DROP COLUMN IF EXISTS "version_query_json";
--> statement-breakpoint
DROP SCHEMA IF EXISTS "docs" CASCADE;
--> statement-breakpoint
CREATE SCHEMA "docs";
--> statement-breakpoint
CREATE TABLE "docs"."releases" (
	"manifest_key" text NOT NULL,
	"manifest_sha256" text NOT NULL,
	"materialized_at" timestamp with time zone NOT NULL,
	"release_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs"."collections" (
	"collection" text NOT NULL,
	"corpus" text NOT NULL,
	"description" text,
	"display_name" text NOT NULL,
	"release_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "collections_release_id_corpus_collection_pk" PRIMARY KEY("release_id","corpus","collection"),
	CONSTRAINT "collections_release_id_releases_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "docs"."releases"("release_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "docs"."documents" (
	"canonical_url" text NOT NULL,
	"collection" text NOT NULL,
	"corpus" text NOT NULL,
	"current_version_id" text NOT NULL,
	"current_version_slug" text NOT NULL,
	"doc_id" text NOT NULL,
	"document_slug" text NOT NULL,
	"release_id" text NOT NULL,
	"title" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "documents_release_id_doc_id_pk" PRIMARY KEY("release_id","doc_id"),
	CONSTRAINT "documents_release_id_releases_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "docs"."releases"("release_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "docs"."document_versions" (
	"delivery_mode" text DEFAULT 'gated_asset' NOT NULL,
	"doc_id" text NOT NULL,
	"effective_from" text,
	"entitlement_groups_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"label" text NOT NULL,
	"release_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version_id" text NOT NULL,
	"version_slug" text NOT NULL,
	"visibility_level" text DEFAULT 'restricted' NOT NULL,
	CONSTRAINT "document_versions_release_id_version_id_pk" PRIMARY KEY("release_id","version_id"),
	CONSTRAINT "document_versions_release_id_releases_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "docs"."releases"("release_id") ON DELETE cascade,
	CONSTRAINT "document_versions_release_id_doc_id_documents_release_id_doc_id_fk" FOREIGN KEY ("release_id","doc_id") REFERENCES "docs"."documents"("release_id","doc_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "docs"."reader_assets" (
	"content_url" text NOT NULL,
	"manifest_url" text,
	"outline_url" text NOT NULL,
	"release_id" text NOT NULL,
	"source_objects_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"static_prefix" text NOT NULL,
	"target_objects_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version_id" text NOT NULL,
	CONSTRAINT "reader_assets_release_id_version_id_pk" PRIMARY KEY("release_id","version_id"),
	CONSTRAINT "reader_assets_release_id_releases_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "docs"."releases"("release_id") ON DELETE cascade,
	CONSTRAINT "reader_assets_release_id_version_id_document_versions_release_id_version_id_fk" FOREIGN KEY ("release_id","version_id") REFERENCES "docs"."document_versions"("release_id","version_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "docs"."search_units" (
	"anchor" text NOT NULL,
	"canonical_url" text NOT NULL,
	"doc_id" text NOT NULL,
	"highlight_root_unit_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"release_id" text NOT NULL,
	"search_text" text NOT NULL,
	"search_unit_id" text NOT NULL,
	"snippet" text NOT NULL,
	"title" text NOT NULL,
	"unit_order" integer NOT NULL,
	"version_id" text NOT NULL,
	CONSTRAINT "search_units_release_id_search_unit_id_pk" PRIMARY KEY("release_id","search_unit_id"),
	CONSTRAINT "search_units_release_id_releases_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "docs"."releases"("release_id") ON DELETE cascade,
	CONSTRAINT "search_units_release_id_doc_id_documents_release_id_doc_id_fk" FOREIGN KEY ("release_id","doc_id") REFERENCES "docs"."documents"("release_id","doc_id") ON DELETE cascade,
	CONSTRAINT "search_units_release_id_version_id_document_versions_release_id_version_id_fk" FOREIGN KEY ("release_id","version_id") REFERENCES "docs"."document_versions"("release_id","version_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "docs_documents_collection_slug_idx" ON "docs"."documents" ("release_id","corpus","collection","document_slug");
--> statement-breakpoint
CREATE INDEX "docs_documents_collection_title_idx" ON "docs"."documents" ("release_id","corpus","collection","title");
--> statement-breakpoint
CREATE INDEX "docs_document_versions_doc_current_idx" ON "docs"."document_versions" ("release_id","doc_id","is_current");
--> statement-breakpoint
CREATE UNIQUE INDEX "docs_document_versions_doc_slug_idx" ON "docs"."document_versions" ("release_id","doc_id","version_slug");
--> statement-breakpoint
CREATE INDEX "docs_document_versions_delivery_visibility_idx" ON "docs"."document_versions" ("release_id","delivery_mode","visibility_level","is_current");
--> statement-breakpoint
CREATE INDEX "docs_reader_assets_static_prefix_idx" ON "docs"."reader_assets" ("release_id","static_prefix");
--> statement-breakpoint
CREATE INDEX "docs_search_units_doc_version_order_idx" ON "docs"."search_units" ("release_id","doc_id","version_id","unit_order");
