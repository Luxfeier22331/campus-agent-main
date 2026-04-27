export const DOCS_READ_MODEL_MANIFEST_SCHEMA_VERSION = "document_reader_publish_manifest_v1";

export interface DocsReadModelCollectionInput {
	collection: string;
	corpus: string;
	description?: string | null;
	displayName: string;
	updatedAt: string;
}

export interface DocsReadModelDocumentInput {
	canonicalUrl: string;
	collection: string;
	corpus: string;
	currentVersionId: string;
	currentVersionSlug: string;
	docId: string;
	documentSlug: string;
	title: string;
	updatedAt: string;
}

export interface DocsReadModelDocumentVersionInput {
	deliveryMode: "public_static_asset" | "gated_asset";
	docId: string;
	effectiveFrom?: string | null;
	entitlementGroups: string[];
	isCurrent: boolean;
	label: string;
	updatedAt: string;
	versionId: string;
	versionSlug: string;
	visibilityLevel: string;
}

export interface DocsReadModelReaderAssetInput {
	contentUrl: string;
	manifestUrl?: string | null;
	outlineUrl: string;
	sourceObjects: Record<string, string>;
	staticPrefix: string;
	targetObjects: Record<string, string>;
	updatedAt: string;
	versionId: string;
}

export interface DocsReadModelSearchUnitInput {
	anchor: string;
	canonicalUrl: string;
	docId: string;
	highlightRootUnitIds: string[];
	searchText: string;
	searchUnitId: string;
	snippet: string;
	title: string;
	unitOrder: number;
	versionId: string;
}

export interface DocsReadModelManifestInput {
	collections: DocsReadModelCollectionInput[];
	documentVersions: DocsReadModelDocumentVersionInput[];
	documents: DocsReadModelDocumentInput[];
	generatedAt: string;
	readerAssets: DocsReadModelReaderAssetInput[];
	schemaVersion: string;
	searchUnits: DocsReadModelSearchUnitInput[];
}

export interface DocsReadModelImportPlan extends DocsReadModelManifestInput {
	scopes: Array<{ collection: string; corpus: string }>;
}

export interface PublicDocsSyncManifest {
	entries: Array<{
		collection: string;
		corpus: string;
		deliveryMode: "public_static_asset";
		docId: string;
		documentSlug: string;
		sourceObjects: Record<string, string>;
		targetObjects: Record<string, string>;
		title: string;
		isCurrent: boolean;
		versionLabel: string;
		versionId: string;
		versionSlug: string;
	}>;
	generatedAt: string;
	surface: "public_docs";
}

export function buildDocsReadModelImportPlan(
	manifest: DocsReadModelManifestInput,
): DocsReadModelImportPlan {
	if (manifest.schemaVersion !== DOCS_READ_MODEL_MANIFEST_SCHEMA_VERSION) {
		throw new Error(
			`unsupported docs read model manifest schemaVersion: ${manifest.schemaVersion}`,
		);
	}

	const scopes = uniqueSortedScopes(manifest.collections);
	return {
		...manifest,
		collections: [...manifest.collections].sort(compareCollection),
		documentVersions: [...manifest.documentVersions].sort(compareDocumentVersion),
		documents: [...manifest.documents].sort(compareDocument),
		readerAssets: [...manifest.readerAssets].sort((left, right) =>
			left.versionId.localeCompare(right.versionId),
		),
		scopes,
		searchUnits: [...manifest.searchUnits].sort(compareSearchUnit),
	};
}

export function buildPublicDocsSyncManifestFromReadModel(
	plan: DocsReadModelImportPlan,
	generatedAt: string,
): PublicDocsSyncManifest {
	const documentsByDocId = new Map(plan.documents.map((document) => [document.docId, document]));
	const publicVersionsById = new Map(
		plan.documentVersions
			.filter(
				(version) =>
					version.deliveryMode === "public_static_asset" &&
					version.visibilityLevel === "public" &&
					version.entitlementGroups.length === 0,
			)
			.map((version) => [version.versionId, version]),
	);

	return {
		entries: plan.readerAssets
			.flatMap((asset) => {
				const version = publicVersionsById.get(asset.versionId);
				const document = version ? documentsByDocId.get(version.docId) : null;
				if (!(version && document)) {
					return [];
				}
				return [
					{
						collection: document.collection,
						corpus: document.corpus,
						deliveryMode: "public_static_asset" as const,
						docId: document.docId,
						documentSlug: document.documentSlug,
						sourceObjects: asset.sourceObjects,
						targetObjects: asset.targetObjects,
						title: document.title,
						isCurrent: version.isCurrent,
						versionLabel: version.label,
						versionId: version.versionId,
						versionSlug: version.versionSlug,
					},
				];
			})
			.sort((left, right) =>
				`${left.docId}:${left.versionId}`.localeCompare(`${right.docId}:${right.versionId}`),
			),
		generatedAt,
		surface: "public_docs",
	};
}

function uniqueSortedScopes(
	collections: DocsReadModelCollectionInput[],
): Array<{ collection: string; corpus: string }> {
	const map = new Map<string, { collection: string; corpus: string }>();
	for (const collection of collections) {
		map.set(`${collection.corpus}/${collection.collection}`, {
			collection: collection.collection,
			corpus: collection.corpus,
		});
	}
	return [...map.values()].sort((left, right) =>
		`${left.corpus}/${left.collection}`.localeCompare(`${right.corpus}/${right.collection}`),
	);
}

function compareCollection(
	left: DocsReadModelCollectionInput,
	right: DocsReadModelCollectionInput,
): number {
	return `${left.corpus}/${left.collection}`.localeCompare(`${right.corpus}/${right.collection}`);
}

function compareDocument(
	left: DocsReadModelDocumentInput,
	right: DocsReadModelDocumentInput,
): number {
	return `${left.corpus}/${left.collection}/${left.documentSlug}`.localeCompare(
		`${right.corpus}/${right.collection}/${right.documentSlug}`,
	);
}

function compareDocumentVersion(
	left: DocsReadModelDocumentVersionInput,
	right: DocsReadModelDocumentVersionInput,
): number {
	return `${left.docId}/${left.versionSlug}`.localeCompare(`${right.docId}/${right.versionSlug}`);
}

function compareSearchUnit(
	left: DocsReadModelSearchUnitInput,
	right: DocsReadModelSearchUnitInput,
): number {
	return `${left.versionId}/${left.unitOrder}/${left.searchUnitId}`.localeCompare(
		`${right.versionId}/${right.unitOrder}/${right.searchUnitId}`,
	);
}
