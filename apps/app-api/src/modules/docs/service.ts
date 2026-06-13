import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import type {
	DocsDocumentSummaryResponse,
	DocsNavigationResponse,
	DocsResolveResponse,
	DocsService,
	DocsVersionsResponse,
	ReaderAssetDeliveryMode,
} from "./index";

export interface DocsCollectionRecord {
	collection: string;
	corpus: string;
	description: string | null;
	displayName: string;
}

export interface DocsVersionAccessRecord {
	deliveryMode: ReaderAssetDeliveryMode;
	entitlementGroups: string[];
	isCurrent?: boolean;
	visibilityLevel: string;
}

export interface DocsDocumentVersionRecord extends DocsVersionAccessRecord {
	canonicalUrl: string;
	collection: string;
	corpus: string;
	currentVersionId: string;
	currentVersionSlug: string;
	docId: string;
	documentSlug: string;
	effectiveFrom?: string | null;
	label?: string;
	title: string;
	updatedAt: string;
	versionId: string;
	versionSlug: string;
}

export interface DocsReaderAssetRecord extends DocsDocumentVersionRecord {
	contentUrl: string;
	manifestUrl: string | null;
	outlineUrl: string;
	sourceObjects?: Record<string, string>;
}

export interface DocsReadModelStore {
	getCollection(input: {
		collection: string;
		corpus: string;
	}): Promise<DocsCollectionRecord | null>;
	getDocumentVersion(input: {
		collection: string;
		corpus: string;
		documentSlug: string;
		version: string | null;
	}): Promise<DocsDocumentVersionRecord | null>;
	getReaderAsset(input: {
		collection: string;
		corpus: string;
		documentSlug: string;
		version: string | null;
	}): Promise<DocsReaderAssetRecord | null>;
	listCollectionDocuments(input: {
		collection: string;
		corpus: string;
	}): Promise<DocsDocumentVersionRecord[]>;
	listDocumentVersions(input: {
		collection: string;
		corpus: string;
		documentSlug: string;
	}): Promise<DocsDocumentVersionRecord[]>;
}

export function buildDocsService(input: { store: DocsReadModelStore }): DocsService {
	const store = input.store;

	return {
		async getDocumentSummary(request) {
			const document = await store.getDocumentVersion({
				collection: request.collection,
				corpus: request.corpus,
				documentSlug: request.documentSlug,
				version: null,
			});
			assertReadableDocument(document, request.principal);

			return {
				document: {
					canonicalUrl: document.canonicalUrl,
					collection: document.collection,
					corpus: document.corpus,
					currentVersionId: document.currentVersionId,
					currentVersionSlug: document.currentVersionSlug,
					docId: document.docId,
					documentSlug: document.documentSlug,
					title: document.title,
					updatedAt: document.updatedAt,
				},
			} satisfies DocsDocumentSummaryResponse;
		},

		async getNavigation(request) {
			const collection = await store.getCollection({
				collection: request.collection,
				corpus: request.corpus,
			});
			if (!collection) {
				throw notFound("docs_collection_not_found", "Document collection was not found.");
			}

			const documents = (
				await store.listCollectionDocuments({
					collection: request.collection,
					corpus: request.corpus,
				})
			).filter(
				(document) =>
					document.isCurrent !== false && canReadDocumentVersion(document, request.principal),
			);
			if (documents.length === 0) {
				throw notFound("docs_collection_not_found", "Document collection was not found.");
			}

			return {
				collection: {
					collection: collection.collection,
					corpus: collection.corpus,
					...(collection.description ? { description: collection.description } : {}),
					displayName: collection.displayName,
				},
				nodes: documents.map((document) => ({
					canonicalUrl: document.canonicalUrl,
					documentSlug: document.documentSlug,
					displayTitle: resolveDocumentDisplayTitle(document.title),
					isCurrent: true,
					kind: "document" as const,
					title: document.title,
				})),
			} satisfies DocsNavigationResponse;
		},

		async getVersions(request) {
			const versions = (
				await store.listDocumentVersions({
					collection: request.collection,
					corpus: request.corpus,
					documentSlug: request.documentSlug,
				})
			).filter((version) => canReadDocumentVersion(version, request.principal));
			if (versions.length === 0) {
				throw notFound("docs_document_not_found", "Document was not found.");
			}

			const document = versions.find((version) => version.isCurrent) ?? versions[0];
			return {
				document: {
					docId: document.docId,
					documentSlug: document.documentSlug,
					title: document.title,
				},
				versions: versions.map((version) => ({
					effectiveFrom: version.effectiveFrom ?? null,
					isCurrent: version.isCurrent === true,
					label: version.label ?? (version.isCurrent ? "现行版" : "历史版本"),
					versionId: version.versionId,
					versionSlug: version.versionSlug,
				})),
			} satisfies DocsVersionsResponse;
		},

		async resolveReader(request) {
			const readerAsset = await store.getReaderAsset({
				collection: request.collection,
				corpus: request.corpus,
				documentSlug: request.documentSlug,
				version: request.version,
			});
			assertReadableDocument(readerAsset, request.principal);
			const canonicalUrl = buildVersionCanonicalUrl(readerAsset);

			return {
				document: {
					canonicalUrl,
					collection: readerAsset.collection,
					corpus: readerAsset.corpus,
					docId: readerAsset.docId,
					documentSlug: readerAsset.documentSlug,
					title: readerAsset.title,
					updatedAt: readerAsset.updatedAt,
					versionId: readerAsset.versionId,
					versionSlug: readerAsset.versionSlug,
				},
				readerAsset: {
					canonicalUrl,
					contentUrl: buildReaderAssetUrl(readerAsset, "reader"),
					deliveryMode: readerAsset.deliveryMode,
					outlineUrl: buildReaderAssetUrl(readerAsset, "outline"),
				},
				readerState: {
					anchor: request.anchor,
					highlightRootUnitIds: request.highlightRootUnitIds,
				},
				resolvedVersion: {
					isCurrent: readerAsset.isCurrent === true,
					label: readerAsset.label ?? (readerAsset.isCurrent ? "现行版" : "历史版本"),
					versionId: readerAsset.versionId,
					versionSlug: readerAsset.versionSlug,
				},
			} satisfies DocsResolveResponse;
		},

		async checkReaderAdmission(request) {
			const readerAsset = await store.getReaderAsset({
				collection: request.collection,
				corpus: request.corpus,
				documentSlug: request.documentSlug,
				version: request.version,
			});
			assertReadableDocument(readerAsset, request.principal);
		},
	};
}

function assertReadableDocument<T extends DocsVersionAccessRecord>(
	record: T | null,
	principal: ResolvedAppPrincipal | null,
): asserts record is T {
	if (!(record && canReadDocumentVersion(record, principal))) {
		throw notFound("docs_document_not_found", "Document was not found.");
	}
}

function canReadDocumentVersion(
	record: DocsVersionAccessRecord,
	principal: ResolvedAppPrincipal | null,
): boolean {
	if (isPublicStaticVersion(record)) {
		return true;
	}
	if (record.visibilityLevel !== "restricted" || record.deliveryMode !== "gated_asset") {
		return false;
	}
	if (record.entitlementGroups.length === 0) {
		return false;
	}
	const principalGroups = principal?.authorization?.entitlementGroups ?? [];
	return record.entitlementGroups.every((group) => principalGroups.includes(group));
}

function isPublicStaticVersion(record: DocsVersionAccessRecord): boolean {
	return (
		record.visibilityLevel === "public" &&
		record.deliveryMode === "public_static_asset" &&
		record.entitlementGroups.length === 0
	);
}

function resolveDocumentDisplayTitle(title: string): string {
	const trimmed = title.trim();
	const displayTitle = trimmed.replace(/^中央民族大学/u, "").trim();
	return displayTitle || trimmed;
}

function buildVersionCanonicalUrl(record: DocsDocumentVersionRecord): string {
	const documentUrl = record.canonicalUrl.split("#", 1)[0].split("?", 1)[0].replace(/\/$/u, "");
	if (record.isCurrent !== false) {
		return documentUrl;
	}
	return `${documentUrl}/v/${encodeURIComponent(record.versionSlug)}`;
}

function buildReaderAssetUrl(
	record: DocsReaderAssetRecord,
	assetKind: "outline" | "reader",
): string {
	if (record.deliveryMode === "public_static_asset") {
		if (assetKind === "reader") {
			return record.contentUrl;
		}
		if (assetKind === "outline") {
			return record.outlineUrl;
		}
	}

	return `/_gated-docs/${encodeURIComponent(record.corpus)}/${encodeURIComponent(
		record.collection,
	)}/${encodeURIComponent(record.documentSlug)}/${encodeURIComponent(
		record.versionSlug,
	)}/${assetKind}.json`;
}

function notFound(code: string, message: string): AppApiRouteError {
	return new AppApiRouteError({
		code,
		message,
		retryable: false,
		status: 404,
	});
}
