export interface ObjectRef {
	byteSize: number;
	key: string;
	sha256: `sha256:${string}`;
}

export interface DocsCollection {
	collection: string;
	corpus: string;
	description?: string | null;
	displayName: string;
	updatedAt: string;
}

export interface DocsDocument {
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

export interface DocsDocumentVersion {
	deliveryMode: "gated_asset" | "public_static_asset";
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

export interface DocsReaderAsset {
	contentUrl: string;
	manifestUrl?: string | null;
	outlineUrl: string;
	sourceObjects: Record<string, string>;
	staticPrefix: string;
	targetObjects: Record<string, string>;
	updatedAt: string;
	versionId: string;
}

export interface DocsSearchUnit {
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

export interface DocsAppProjection {
	collections: DocsCollection[];
	documentVersions: DocsDocumentVersion[];
	documents: DocsDocument[];
	readerAssets: DocsReaderAsset[];
	schemaVersion: "campus_docs_app_projection.v1";
	searchUnits: DocsSearchUnit[];
}

export interface DocsReleaseManifestEntry {
	collection: string;
	corpus: string;
	deliveryMode: "gated_asset" | "public_static_asset";
	docId: string;
	documentSlug: string;
	isCurrent: boolean;
	sourceObjects: Record<string, string>;
	targetObjects: Record<string, string>;
	title: string;
	versionId: string;
	versionLabel: string;
	versionSlug: string;
}

export interface DocsReleaseSearchUnit {
	anchor: string;
	canonicalUrl: string;
	collection: string;
	corpus: string;
	docId: string;
	documentSlug: string;
	documentTitle: string;
	highlightRootUnitIds: string[];
	searchUnitId: string;
	snippet: string;
	title: string;
	versionId: string;
	versionSlug: string;
}

export interface DocsReleaseManifest {
	entries: DocsReleaseManifestEntry[];
	projection: ObjectRef;
	schemaVersion: "campus_docs_release_manifest.v1";
	searchUnits: DocsReleaseSearchUnit[];
	sourceReleaseRefs: ObjectRef[];
	surface: "campus_docs";
}

export interface DocsReleaseRef {
	releaseId: `sha256:${string}`;
	schemaVersion: "campus_docs_release_ref.v1";
}

export interface DocsObjectStore {
	createOrVerify(input: { body: Uint8Array; contentType: string; key: string }): Promise<ObjectRef>;
	read(input: ObjectRef): Promise<Uint8Array>;
	readByKey(key: string): Promise<Uint8Array | undefined>;
}
