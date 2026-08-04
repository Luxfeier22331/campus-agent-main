export interface PublishedObjectRef {
	byteSize: number;
	key: string;
	sha256: `sha256:${string}`;
}

export interface ReaderObjectStoreClient {
	readOptionalBytesObject(input: { key: string }): Promise<Uint8Array | undefined>;
}

export interface ReaderObjectStoreWriter extends ReaderObjectStoreClient {
	writeBytesObject(input: { body: Uint8Array; contentType: string; key: string }): Promise<void>;
}

export interface PublishedReaderCollection {
	collection: string;
	corpus: string;
	description: string | null;
	displayName: string;
}

export interface PublishedReaderTopic {
	corpus: string;
	description: string | null;
	displayName: string;
	order: number;
	topicId: string;
}

export interface PublishedReaderRedirect {
	fromPath: string;
	statusCode: 308;
	toPath: string;
}

export interface PublishedReaderSupplementAsset {
	object: PublishedObjectRef;
	path: string;
}

export interface PublishedReaderSupplement {
	assets: PublishedReaderSupplementAsset[];
	kind: "course_maps";
	object: PublishedObjectRef;
	path: "course-maps.json";
}

export interface PublishedReaderManifestEntry {
	collection: string;
	corpus: string;
	docId: string;
	documentSlug: string;
	effectiveFrom: string | null;
	isCurrent: boolean;
	reader: PublishedObjectRef;
	routeSlug: string;
	sourceLabel: string;
	supplements: PublishedReaderSupplement[];
	title: string;
	topicId: string | null;
	updatedAt: string;
	versionId: string;
	versionLabel: string;
	versionSlug: string;
}

export type RoutedPublishedReaderManifestEntry = PublishedReaderManifestEntry;

export interface PublishedReaderManifest {
	collections: PublishedReaderCollection[];
	entries: PublishedReaderManifestEntry[];
	redirects: PublishedReaderRedirect[];
	topics: PublishedReaderTopic[];
}

export interface ReaderSyncInput {
	client: ReaderObjectStoreClient;
	docsRoot?: string;
	manifest: PublishedReaderManifest;
	targetRoot?: string;
}

export interface ReaderSyncDocsResult {
	generatedDocumentCount: number;
}

export interface ReaderSyncAssetsResult {
	copiedAssetCount: number;
	copiedDocumentCount: number;
}

export interface ReaderSyncCheckResult {
	checkedDocumentCount: number;
	checkedObjectCount: number;
}

export interface ReaderAssetCopy {
	bytes: Uint8Array;
	filePath: string;
	targetObject: string;
	targetPath: string;
}

export type ObjectStoreCredentialMode = "derived";

export interface PublishedReaderObjectStoreEnv {
	OBJECT_STORE_DERIVED_READ_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_READ_SECRET_KEY?: string;
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_ENDPOINT?: string;
}

export interface PublishedReaderObjectStoreCredentials {
	accessKeyId: string;
	credentialMode: ObjectStoreCredentialMode;
	secretAccessKey: string;
}

export interface PublishedReaderObjectStoreConfig extends PublishedReaderObjectStoreCredentials {
	bucket: string;
	endpoint: string;
	region: string;
}
