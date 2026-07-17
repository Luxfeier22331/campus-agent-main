import {
	boolean,
	foreignKey,
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

export const docsReleases = docs.table("releases", {
	manifestKey: text("manifest_key").notNull(),
	manifestSha256: text("manifest_sha256").notNull(),
	materializedAt: timestamp("materialized_at", { withTimezone: true }).notNull(),
	releaseId: text("release_id").primaryKey(),
});

export const docsCollections = docs.table(
	"collections",
	{
		collection: text("collection").notNull(),
		corpus: text("corpus").notNull(),
		description: text("description"),
		displayName: text("display_name").notNull(),
		releaseId: text("release_id")
			.notNull()
			.references(() => docsReleases.releaseId, { onDelete: "cascade" }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		primary: primaryKey({ columns: [table.releaseId, table.corpus, table.collection] }),
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
		docId: text("doc_id").notNull(),
		documentSlug: text("document_slug").notNull(),
		releaseId: text("release_id")
			.notNull()
			.references(() => docsReleases.releaseId, { onDelete: "cascade" }),
		title: text("title").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		primary: primaryKey({ columns: [table.releaseId, table.docId] }),
		collectionSlugUnique: uniqueIndex("docs_documents_collection_slug_idx").on(
			table.releaseId,
			table.corpus,
			table.collection,
			table.documentSlug,
		),
		collectionTitleIndex: index("docs_documents_collection_title_idx").on(
			table.releaseId,
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
		docId: text("doc_id").notNull(),
		effectiveFrom: text("effective_from"),
		entitlementGroupsJson: jsonb("entitlement_groups_json").$type<string[]>().notNull().default([]),
		isCurrent: boolean("is_current").notNull().default(false),
		label: text("label").notNull(),
		releaseId: text("release_id")
			.notNull()
			.references(() => docsReleases.releaseId, { onDelete: "cascade" }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		versionId: text("version_id").notNull(),
		versionSlug: text("version_slug").notNull(),
		visibilityLevel: text("visibility_level").notNull().default("restricted"),
	},
	(table) => ({
		primary: primaryKey({ columns: [table.releaseId, table.versionId] }),
		documentForeignKey: foreignKey({
			columns: [table.releaseId, table.docId],
			foreignColumns: [docsDocuments.releaseId, docsDocuments.docId],
		}).onDelete("cascade"),
		docCurrentIndex: index("docs_document_versions_doc_current_idx").on(
			table.releaseId,
			table.docId,
			table.isCurrent,
		),
		docVersionSlugUnique: uniqueIndex("docs_document_versions_doc_slug_idx").on(
			table.releaseId,
			table.docId,
			table.versionSlug,
		),
		deliveryVisibilityIndex: index("docs_document_versions_delivery_visibility_idx").on(
			table.releaseId,
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
		releaseId: text("release_id")
			.notNull()
			.references(() => docsReleases.releaseId, { onDelete: "cascade" }),
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
		versionId: text("version_id").notNull(),
	},
	(table) => ({
		primary: primaryKey({ columns: [table.releaseId, table.versionId] }),
		versionForeignKey: foreignKey({
			columns: [table.releaseId, table.versionId],
			foreignColumns: [docsDocumentVersions.releaseId, docsDocumentVersions.versionId],
		}).onDelete("cascade"),
		staticPrefixIndex: index("docs_reader_assets_static_prefix_idx").on(
			table.releaseId,
			table.staticPrefix,
		),
	}),
);

export const docsSearchUnits = docs.table(
	"search_units",
	{
		anchor: text("anchor").notNull(),
		canonicalUrl: text("canonical_url").notNull(),
		docId: text("doc_id").notNull(),
		highlightRootUnitIdsJson: jsonb("highlight_root_unit_ids_json")
			.$type<string[]>()
			.notNull()
			.default([]),
		searchText: text("search_text").notNull(),
		releaseId: text("release_id")
			.notNull()
			.references(() => docsReleases.releaseId, { onDelete: "cascade" }),
		searchUnitId: text("search_unit_id").notNull(),
		snippet: text("snippet").notNull(),
		title: text("title").notNull(),
		unitOrder: integer("unit_order").notNull(),
		versionId: text("version_id").notNull(),
	},
	(table) => ({
		primary: primaryKey({ columns: [table.releaseId, table.searchUnitId] }),
		documentForeignKey: foreignKey({
			columns: [table.releaseId, table.docId],
			foreignColumns: [docsDocuments.releaseId, docsDocuments.docId],
		}).onDelete("cascade"),
		versionForeignKey: foreignKey({
			columns: [table.releaseId, table.versionId],
			foreignColumns: [docsDocumentVersions.releaseId, docsDocumentVersions.versionId],
		}).onDelete("cascade"),
		docVersionOrderIndex: index("docs_search_units_doc_version_order_idx").on(
			table.releaseId,
			table.docId,
			table.versionId,
			table.unitOrder,
		),
	}),
);
