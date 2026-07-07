export interface ReaderObjectStoreClient {
	readOptionalBytesObject(input: { key: string }): Promise<Uint8Array | undefined>;
	readTextObject(input: { key: string }): Promise<string>;
}

export interface ReaderSyncInput {
	client: ReaderObjectStoreClient;
	docsRoot?: string;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	targetRoot?: string;
}

export function parsePublishedReaderSyncArgs(argv: string[]): {
	command: "all" | "docs" | "assets" | "check";
	manifestFilePath?: string;
	manifestObjectKey?: string;
};

export function resolvePublishedReaderObjectStoreBucket(env: {
	OBJECT_STORE_BUCKET_DERIVED?: string;
}): string;

export function resolvePublishedReaderObjectStoreConfig(env: {
	OBJECT_STORE_ACCESS_KEY?: string;
	OBJECT_STORE_BUCKET_DERIVED?: string;
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_REGION?: string;
	OBJECT_STORE_SECRET_KEY?: string;
}): {
	accessKeyId: string;
	bucket: string;
	credentialMode: "derived" | "shared";
	endpoint: string;
	region: string;
	secretAccessKey: string;
};

export function resolvePublishedReaderObjectStoreCredentials(env: {
	OBJECT_STORE_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_SECRET_KEY?: string;
}): {
	accessKeyId: string;
	credentialMode: "derived" | "shared";
	secretAccessKey: string;
};

export function syncCampusPublishedReaderDocs(
	input: ReaderSyncInput,
): Promise<{ generatedDocumentCount: number }>;

export function syncCampusPublishedReaderAssets(input: ReaderSyncInput): Promise<{
	copiedAssetCount: number;
	copiedDocumentCount: number;
	copiedGatedDocumentCount: number;
	copiedPublicDocumentCount: number;
}>;

export function checkCampusPublishedReaderInputs(input: ReaderSyncInput): Promise<{
	checkedDocumentCount: number;
	checkedObjectCount: number;
	checkedProtectedSearchIndexCount: number;
}>;
