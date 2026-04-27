import {
	boolean,
	index,
	integer,
	jsonb,
	pgSchema,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import type { ReaderAssetDeliveryMode } from "../../modules/docs";

const docs = pgSchema("docs");

export const docsCollections = docs.table(
	"collections",
	{
		collection: text("collection").notNull(),
		corpus: text("corpus").notNull(),
		description: text("description"),
		displayName: text("display_name").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		primary: primaryKey({ columns: [table.corpus, table.collection] }),
	}),
);

export const docsDocuments = docs.table(
	"documents",
	{
		canonicalUrl: text("canonical_url").notNull(),
		collection: text("collection").notNull(),
		corpus: text("corpus").notNull(),
		currentVersionId: text("current_version_id").notNull(),
		currentVersionSlug: text("current_version_slug").notNull(),
		docId: text("doc_id").primaryKey(),
		documentSlug: text("document_slug").notNull(),
		title: text("title").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		collectionSlugUnique: uniqueIndex("docs_documents_collection_slug_idx").on(
			table.corpus,
			table.collection,
			table.documentSlug,
		),
		collectionTitleIndex: index("docs_documents_collection_title_idx").on(
			table.corpus,
			table.collection,
			table.title,
		),
	}),
);

export const docsDocumentVersions = docs.table(
	"document_versions",
	{
		deliveryMode: text("delivery_mode")
			.$type<ReaderAssetDeliveryMode>()
			.notNull()
			.default("gated_asset"),
		docId: text("doc_id")
			.notNull()
			.references(() => docsDocuments.docId, { onDelete: "cascade" }),
		effectiveFrom: text("effective_from"),
		entitlementGroupsJson: jsonb("entitlement_groups_json").$type<string[]>().notNull().default([]),
		isCurrent: boolean("is_current").notNull().default(false),
		label: text("label").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		versionId: text("version_id").primaryKey(),
		versionSlug: text("version_slug").notNull(),
		visibilityLevel: text("visibility_level").notNull().default("restricted"),
	},
	(table) => ({
		docCurrentIndex: index("docs_document_versions_doc_current_idx").on(
			table.docId,
			table.isCurrent,
		),
		docVersionSlugUnique: uniqueIndex("docs_document_versions_doc_slug_idx").on(
			table.docId,
			table.versionSlug,
		),
		deliveryVisibilityIndex: index("docs_document_versions_delivery_visibility_idx").on(
			table.deliveryMode,
			table.visibilityLevel,
			table.isCurrent,
		),
	}),
);

export const docsReaderAssets = docs.table(
	"reader_assets",
	{
		contentUrl: text("content_url").notNull(),
		manifestUrl: text("manifest_url"),
		outlineUrl: text("outline_url").notNull(),
		sourceObjectsJson: jsonb("source_objects_json")
			.$type<Record<string, string>>()
			.notNull()
			.default({}),
		staticPrefix: text("static_prefix").notNull(),
		targetObjectsJson: jsonb("target_objects_json")
			.$type<Record<string, string>>()
			.notNull()
			.default({}),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		versionId: text("version_id")
			.primaryKey()
			.references(() => docsDocumentVersions.versionId, { onDelete: "cascade" }),
	},
	(table) => ({
		staticPrefixIndex: index("docs_reader_assets_static_prefix_idx").on(table.staticPrefix),
	}),
);

export const docsSearchUnits = docs.table(
	"search_units",
	{
		anchor: text("anchor").notNull(),
		canonicalUrl: text("canonical_url").notNull(),
		docId: text("doc_id")
			.notNull()
			.references(() => docsDocuments.docId, { onDelete: "cascade" }),
		highlightRootUnitIdsJson: jsonb("highlight_root_unit_ids_json")
			.$type<string[]>()
			.notNull()
			.default([]),
		searchText: text("search_text").notNull(),
		searchUnitId: text("search_unit_id").primaryKey(),
		snippet: text("snippet").notNull(),
		title: text("title").notNull(),
		unitOrder: integer("unit_order").notNull(),
		versionId: text("version_id")
			.notNull()
			.references(() => docsDocumentVersions.versionId, { onDelete: "cascade" }),
	},
	(table) => ({
		docVersionOrderIndex: index("docs_search_units_doc_version_order_idx").on(
			table.docId,
			table.versionId,
			table.unitOrder,
		),
		searchTextIndex: index("docs_search_units_search_text_idx").on(table.searchText),
		versionSearchTextIndex: index("docs_search_units_version_search_text_idx").on(
			table.versionId,
			table.searchText,
		),
	}),
);
