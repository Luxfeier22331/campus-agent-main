CREATE SCHEMA IF NOT EXISTS "docs";
--> statement-breakpoint
CREATE TABLE "docs"."collections" (
    "collection" text NOT NULL,
    "corpus" text NOT NULL,
    "description" text,
    "display_name" text NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    CONSTRAINT "collections_corpus_collection_pk" PRIMARY KEY ("corpus", "collection")
);
--> statement-breakpoint
CREATE TABLE "docs"."document_versions" (
    "delivery_mode" text DEFAULT 'gated_asset' NOT NULL,
    "doc_id" text NOT NULL,
    "effective_from" text,
    "entitlement_groups_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "is_current" boolean DEFAULT false NOT NULL,
    "label" text NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "version_id" text PRIMARY KEY NOT NULL,
    "version_slug" text NOT NULL,
    "visibility_level" text DEFAULT 'restricted' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs"."documents" (
    "canonical_url" text NOT NULL,
    "collection" text NOT NULL,
    "corpus" text NOT NULL,
    "current_version_id" text NOT NULL,
    "current_version_slug" text NOT NULL,
    "doc_id" text PRIMARY KEY NOT NULL,
    "document_slug" text NOT NULL,
    "title" text NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs"."reader_assets" (
    "content_url" text NOT NULL,
    "manifest_url" text,
    "outline_url" text NOT NULL,
    "source_objects_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "static_prefix" text NOT NULL,
    "target_objects_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "version_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs"."search_units" (
    "anchor" text NOT NULL,
    "canonical_url" text NOT NULL,
    "doc_id" text NOT NULL,
    "highlight_root_unit_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "search_text" text NOT NULL,
    "search_unit_id" text PRIMARY KEY NOT NULL,
    "snippet" text NOT NULL,
    "title" text NOT NULL,
    "unit_order" integer NOT NULL,
    "version_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs"."document_versions"
ADD CONSTRAINT "document_versions_doc_id_documents_doc_id_fk"
FOREIGN KEY (
    "doc_id"
) REFERENCES "docs"."documents" ("doc_id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "docs"."reader_assets"
ADD CONSTRAINT "reader_assets_version_id_document_versions_version_id_fk"
FOREIGN KEY (
    "version_id"
) REFERENCES "docs"."document_versions" ("version_id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "docs"."search_units"
ADD CONSTRAINT "search_units_doc_id_documents_doc_id_fk"
FOREIGN KEY (
    "doc_id"
) REFERENCES "docs"."documents" ("doc_id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "docs"."search_units"
ADD CONSTRAINT "search_units_version_id_document_versions_version_id_fk"
FOREIGN KEY (
    "version_id"
) REFERENCES "docs"."document_versions" ("version_id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "docs_document_versions_doc_current_idx"
ON "docs"."document_versions" USING btree (
    "doc_id", "is_current"
);
--> statement-breakpoint
CREATE UNIQUE INDEX "docs_document_versions_doc_slug_idx"
ON "docs"."document_versions" USING btree (
    "doc_id", "version_slug"
);
--> statement-breakpoint
CREATE INDEX "docs_document_versions_delivery_visibility_idx"
ON "docs"."document_versions" USING btree (
    "delivery_mode", "visibility_level", "is_current"
);
--> statement-breakpoint
CREATE UNIQUE INDEX "docs_documents_collection_slug_idx"
ON "docs"."documents" USING btree (
    "corpus", "collection", "document_slug"
);
--> statement-breakpoint
CREATE INDEX "docs_documents_collection_title_idx"
ON "docs"."documents" USING btree (
    "corpus", "collection", "title"
);
--> statement-breakpoint
CREATE INDEX "docs_reader_assets_static_prefix_idx"
ON "docs"."reader_assets" USING btree (
    "static_prefix"
);
--> statement-breakpoint
CREATE INDEX "docs_search_units_doc_version_order_idx"
ON "docs"."search_units" USING btree (
    "doc_id", "version_id", "unit_order"
);
--> statement-breakpoint
CREATE INDEX "docs_search_units_search_text_idx"
ON "docs"."search_units" USING btree (
    "search_text"
);
CREATE INDEX "docs_search_units_version_search_text_idx"
ON "docs"."search_units" USING btree (
    "version_id", "search_text"
);
