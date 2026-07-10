export interface ReaderObjectStoreClient {
	readOptionalBytesObject(input: { key: string }): Promise<Uint8Array | undefined>;
	readTextObject(input: { key: string }): Promise<string>;
}

export interface PublishedReaderObjectStoreClient {
	readTextObject(input: { key: string }): Promise<string>;
}

export type PublishedReaderDeliveryMode = "gated_asset" | "public_static_asset" | "withheld";

export interface PublishedReaderManifestEntry {
	collection: string;
	corpus: string;
	deliveryMode: PublishedReaderDeliveryMode;
	docId?: string;
	documentSlug: string;
	isCurrent: boolean;
	sourceObjects: Record<string, string>;
	targetObjects: Record<string, string>;
	title: string;
	versionId?: string;
	versionLabel?: string;
	versionSlug: string;
}

export interface RoutedPublishedReaderManifestEntry extends PublishedReaderManifestEntry {
	routeSlug: string;
}

export interface PublishedReaderSearchUnit {
	anchor: string;
	canonicalUrl: string;
	collection: string;
	corpus: string;
	docId?: string;
	documentSlug: string;
	documentTitle: string;
	highlightRootUnitIds: string[];
	searchUnitId: string;
	snippet: string;
	title: string;
	versionId: string;
	versionSlug: string;
}

export interface PublishedReaderManifest {
	entries: PublishedReaderManifestEntry[];
	generatedAt?: string;
	searchUnits: unknown[];
}

export type PublishedReaderSyncCommand = "all" | "assets" | "check" | "docs";

export interface PublishedReaderSyncArgs {
	command: PublishedReaderSyncCommand;
	manifestFilePath?: string;
	manifestObjectKey?: string;
}

export interface ReaderSyncInput {
	client: ReaderObjectStoreClient;
	docsRoot?: string;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	targetRoot?: string;
}

export interface ReaderSyncDocsResult {
	generatedDocumentCount: number;
	generatedGatedDocumentCount: number;
	generatedPublicDocumentCount: number;
}

export interface ReaderSyncAssetsResult {
	copiedAssetCount: number;
	copiedDocumentCount: number;
	copiedGatedDocumentCount: number;
	copiedPublicDocumentCount: number;
}

export interface ReaderSyncCheckResult {
	checkedDocumentCount: number;
	checkedObjectCount: number;
	checkedProtectedSearchIndexCount: number;
}

export interface ReaderAssetCopy {
	bytes: Uint8Array;
	filePath: string;
	targetObject: string;
	targetPath: string;
}

export interface ReaderAssetTarget {
	filePath: string;
	targetObject: string;
	targetPath: string;
}

export interface CourseMapBlock {
	blockId: string;
	parentHeadingHint: string;
	targetUrl: string;
	title: string;
}

export type CourseMapsByHeading = Map<string, CourseMapBlock[]>;

export interface ReaderBlock {
	kind?: unknown;
	rootUnitId?: unknown;
	text?: unknown;
}

export interface ReaderSection {
	anchor?: unknown;
	blocks?: unknown;
	title?: unknown;
}

export interface ReaderDocumentPayload {
	document?: {
		title?: string;
	};
	sections?: ReaderSection[];
	supplements?: unknown;
}

export interface ReaderMetaPayload {
	resolvedVersion?: {
		label?: string;
	};
	source?: {
		title?: string;
	};
	sourceLabel?: string;
}

export interface ReaderPublicVersion {
	isCurrent: boolean;
	label: string;
	versionSlug: string;
}

export type EntriesByScope = Map<string, RoutedPublishedReaderManifestEntry[]>;

export type ObjectStoreCredentialMode = "derived" | "shared";

export interface PublishedReaderObjectStoreEnv {
	OBJECT_STORE_ACCESS_KEY?: string;
	OBJECT_STORE_BUCKET_DERIVED?: string;
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_REGION?: string;
	OBJECT_STORE_SECRET_KEY?: string;
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
