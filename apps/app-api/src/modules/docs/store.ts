import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { createRuntimeDbGetter, type RuntimeDbGetter } from "../../db/runtime";
import {
	docsCollections,
	docsDocuments,
	docsDocumentVersions,
	docsReaderAssets,
	docsSearchUnits,
} from "../../db/schema";
import type {
	DocsCollectionRecord,
	DocsDocumentVersionRecord,
	DocsReaderAssetRecord,
	DocsReadModelStore,
	DocsSearchUnitRecord,
} from "./service";

export function createPgDocsReadModelStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): DocsReadModelStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getCollection(input) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(docsCollections)
				.where(
					and(
						eq(docsCollections.corpus, input.corpus),
						eq(docsCollections.collection, input.collection),
					),
				)
				.limit(1);
			return rows[0] ? toCollectionRecord(rows[0]) : null;
		},

		async getDocumentVersion(input) {
			const db = await getDb();
			const rows = await db
				.select(documentVersionSelection)
				.from(docsDocuments)
				.innerJoin(
					docsDocumentVersions,
					and(
						eq(docsDocumentVersions.docId, docsDocuments.docId),
						input.version
							? eq(docsDocumentVersions.versionSlug, input.version)
							: eq(docsDocumentVersions.versionId, docsDocuments.currentVersionId),
					),
				)
				.where(
					and(
						eq(docsDocuments.corpus, input.corpus),
						eq(docsDocuments.collection, input.collection),
						eq(docsDocuments.documentSlug, input.documentSlug),
					),
				)
				.limit(1);
			return rows[0] ? toDocumentVersionRecord(rows[0]) : null;
		},

		async getReaderAsset(input) {
			const db = await getDb();
			const rows = await db
				.select({
					...documentVersionSelection,
					contentUrl: docsReaderAssets.contentUrl,
					manifestUrl: docsReaderAssets.manifestUrl,
					outlineUrl: docsReaderAssets.outlineUrl,
				})
				.from(docsDocuments)
				.innerJoin(
					docsDocumentVersions,
					and(
						eq(docsDocumentVersions.docId, docsDocuments.docId),
						input.version
							? eq(docsDocumentVersions.versionSlug, input.version)
							: eq(docsDocumentVersions.versionId, docsDocuments.currentVersionId),
					),
				)
				.innerJoin(docsReaderAssets, eq(docsReaderAssets.versionId, docsDocumentVersions.versionId))
				.where(
					and(
						eq(docsDocuments.corpus, input.corpus),
						eq(docsDocuments.collection, input.collection),
						eq(docsDocuments.documentSlug, input.documentSlug),
					),
				)
				.limit(1);
			return rows[0] ? toReaderAssetRecord(rows[0]) : null;
		},

		async listCollectionDocuments(input) {
			const db = await getDb();
			const rows = await db
				.select(documentVersionSelection)
				.from(docsDocuments)
				.innerJoin(
					docsDocumentVersions,
					eq(docsDocumentVersions.versionId, docsDocuments.currentVersionId),
				)
				.where(
					and(
						eq(docsDocuments.corpus, input.corpus),
						eq(docsDocuments.collection, input.collection),
					),
				)
				.orderBy(asc(docsDocuments.title), asc(docsDocuments.documentSlug));
			return rows.map(toDocumentVersionRecord);
		},

		async listDocumentVersions(input) {
			const db = await getDb();
			const rows = await db
				.select(documentVersionSelection)
				.from(docsDocuments)
				.innerJoin(docsDocumentVersions, eq(docsDocumentVersions.docId, docsDocuments.docId))
				.where(
					and(
						eq(docsDocuments.corpus, input.corpus),
						eq(docsDocuments.collection, input.collection),
						eq(docsDocuments.documentSlug, input.documentSlug),
					),
				)
				.orderBy(desc(docsDocumentVersions.isCurrent), asc(docsDocumentVersions.versionSlug));
			return rows.map(toDocumentVersionRecord);
		},

		async searchCurrentPublic(input) {
			const db = await getDb();
			const pattern = `%${input.query}%`;
			const rows = await db
				.select({
					anchor: docsSearchUnits.anchor,
					canonicalUrl: docsSearchUnits.canonicalUrl,
					collection: docsDocuments.collection,
					corpus: docsDocuments.corpus,
					deliveryMode: docsDocumentVersions.deliveryMode,
					docId: docsDocuments.docId,
					documentSlug: docsDocuments.documentSlug,
					documentTitle: docsDocuments.title,
					entitlementGroups: docsDocumentVersions.entitlementGroupsJson,
					highlightRootUnitIds: docsSearchUnits.highlightRootUnitIdsJson,
					isCurrent: docsDocumentVersions.isCurrent,
					snippet: docsSearchUnits.snippet,
					title: docsSearchUnits.title,
					versionId: docsDocumentVersions.versionId,
					versionSlug: docsDocumentVersions.versionSlug,
					visibilityLevel: docsDocumentVersions.visibilityLevel,
				})
				.from(docsSearchUnits)
				.innerJoin(docsDocuments, eq(docsDocuments.docId, docsSearchUnits.docId))
				.innerJoin(
					docsDocumentVersions,
					and(
						eq(docsDocumentVersions.versionId, docsSearchUnits.versionId),
						eq(docsDocumentVersions.versionId, docsDocuments.currentVersionId),
					),
				)
				.where(
					and(
						eq(docsDocuments.corpus, input.corpus),
						eq(docsDocuments.collection, input.collection),
						eq(docsDocumentVersions.deliveryMode, "public_static_asset"),
						eq(docsDocumentVersions.visibilityLevel, "public"),
						sql`jsonb_array_length(${docsDocumentVersions.entitlementGroupsJson}) = 0`,
						or(ilike(docsSearchUnits.searchText, pattern), ilike(docsSearchUnits.title, pattern)),
					),
				)
				.orderBy(asc(docsSearchUnits.unitOrder))
				.limit(input.limit);
			return rows.map(toSearchUnitRecord);
		},
	};
}

const documentVersionSelection = {
	canonicalUrl: docsDocuments.canonicalUrl,
	collection: docsDocuments.collection,
	corpus: docsDocuments.corpus,
	currentVersionId: docsDocuments.currentVersionId,
	currentVersionSlug: docsDocuments.currentVersionSlug,
	deliveryMode: docsDocumentVersions.deliveryMode,
	docId: docsDocuments.docId,
	documentSlug: docsDocuments.documentSlug,
	effectiveFrom: docsDocumentVersions.effectiveFrom,
	entitlementGroups: docsDocumentVersions.entitlementGroupsJson,
	isCurrent: docsDocumentVersions.isCurrent,
	label: docsDocumentVersions.label,
	title: docsDocuments.title,
	updatedAt: docsDocuments.updatedAt,
	versionId: docsDocumentVersions.versionId,
	versionSlug: docsDocumentVersions.versionSlug,
	visibilityLevel: docsDocumentVersions.visibilityLevel,
};

interface DocumentVersionSelectionRow {
	canonicalUrl: string;
	collection: string;
	corpus: string;
	currentVersionId: string;
	currentVersionSlug: string;
	deliveryMode: "public_static_asset" | "gated_asset";
	docId: string;
	documentSlug: string;
	effectiveFrom: string | null;
	entitlementGroups: string[];
	isCurrent: boolean;
	label: string;
	title: string;
	updatedAt: Date;
	versionId: string;
	versionSlug: string;
	visibilityLevel: string;
}

function toCollectionRecord(row: typeof docsCollections.$inferSelect): DocsCollectionRecord {
	return {
		collection: row.collection,
		corpus: row.corpus,
		description: row.description,
		displayName: row.displayName,
	};
}

function toDocumentVersionRecord(row: DocumentVersionSelectionRow): DocsDocumentVersionRecord {
	return {
		canonicalUrl: row.canonicalUrl,
		collection: row.collection,
		corpus: row.corpus,
		currentVersionId: row.currentVersionId,
		currentVersionSlug: row.currentVersionSlug,
		deliveryMode: row.deliveryMode,
		docId: row.docId,
		documentSlug: row.documentSlug,
		effectiveFrom: row.effectiveFrom,
		entitlementGroups: row.entitlementGroups,
		isCurrent: row.isCurrent,
		label: row.label,
		title: row.title,
		updatedAt: row.updatedAt.toISOString(),
		versionId: row.versionId,
		versionSlug: row.versionSlug,
		visibilityLevel: row.visibilityLevel,
	};
}

function toReaderAssetRecord(
	row: DocumentVersionSelectionRow & {
		contentUrl: string;
		manifestUrl: string | null;
		outlineUrl: string;
	},
): DocsReaderAssetRecord {
	return {
		...toDocumentVersionRecord(row),
		contentUrl: row.contentUrl,
		manifestUrl: row.manifestUrl,
		outlineUrl: row.outlineUrl,
	};
}

function toSearchUnitRecord(row: {
	anchor: string;
	canonicalUrl: string;
	collection: string;
	corpus: string;
	deliveryMode: "public_static_asset" | "gated_asset";
	docId: string;
	documentSlug: string;
	documentTitle: string;
	entitlementGroups: string[];
	highlightRootUnitIds: string[];
	isCurrent: boolean;
	snippet: string;
	title: string;
	versionId: string;
	versionSlug: string;
	visibilityLevel: string;
}): DocsSearchUnitRecord {
	return {
		anchor: row.anchor,
		canonicalUrl: row.canonicalUrl,
		collection: row.collection,
		corpus: row.corpus,
		deliveryMode: row.deliveryMode,
		docId: row.docId,
		documentSlug: row.documentSlug,
		documentTitle: row.documentTitle,
		entitlementGroups: row.entitlementGroups,
		highlightRootUnitIds: row.highlightRootUnitIds,
		isCurrent: row.isCurrent,
		snippet: row.snippet,
		title: row.title,
		versionId: row.versionId,
		versionSlug: row.versionSlug,
		visibilityLevel: row.visibilityLevel,
	};
}
