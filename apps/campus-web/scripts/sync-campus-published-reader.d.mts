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

export function resolvePublishedReaderObjectStoreBucket(env: {
	OBJECT_STORE_BUCKET_DERIVED?: string;
}): string;

export function syncCampusPublishedReaderDocs(
	input: ReaderSyncInput,
): Promise<{ generatedDocumentCount: number }>;

export function syncCampusPublishedReaderAssets(input: ReaderSyncInput): Promise<{
	copiedAssetCount: number;
	copiedDocumentCount: number;
	copiedGatedDocumentCount: number;
	copiedPublicDocumentCount: number;
}>;
