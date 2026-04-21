import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { PutObjectCommand, type PutObjectCommandInput, S3Client } from "@aws-sdk/client-s3";

export interface StoredArtifactRef {
	objectKey: string;
	contentSha256: string;
	byteSize: number;
	recordCount?: number;
}

export interface OfficialWebArtifactStore {
	putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef>;
}

export interface OfficialWebObjectStoreEnvironment {
	OBJECT_STORE_ACCESS_KEY?: string;
	OBJECT_STORE_BUCKET_SOURCE?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_REGION?: string;
	OBJECT_STORE_SECRET_KEY?: string;
	OBJECT_STORE_SOURCE_ACCESS_KEY?: string;
	OBJECT_STORE_SOURCE_SECRET_KEY?: string;
}

export class FilesystemArtifactStore implements OfficialWebArtifactStore {
	private readonly rootDir: string;

	constructor(rootDir: string) {
		this.rootDir = rootDir;
	}

	async putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef> {
		const targetPath = resolve(this.rootDir, input.objectKey);
		mkdirSync(dirname(targetPath), { recursive: true });
		writeFileSync(targetPath, input.data);
		return {
			objectKey: input.objectKey,
			contentSha256: createHash("sha256").update(input.data).digest("hex"),
			byteSize: input.data.byteLength,
			recordCount: input.recordCount,
		};
	}
}

export class S3ArtifactStore implements OfficialWebArtifactStore {
	private readonly bucket: string;
	private readonly client: Pick<S3Client, "send">;

	constructor(input: {
		bucket: string;
		client: Pick<S3Client, "send">;
	}) {
		this.bucket = input.bucket;
		this.client = input.client;
	}

	async putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef> {
		const commandInput: PutObjectCommandInput = {
			Bucket: this.bucket,
			Key: input.objectKey,
			Body: input.data,
			ContentType: input.contentType,
		};
		await this.client.send(new PutObjectCommand(commandInput));
		return {
			objectKey: input.objectKey,
			contentSha256: createHash("sha256").update(input.data).digest("hex"),
			byteSize: input.data.byteLength,
			recordCount: input.recordCount,
		};
	}
}

export function createS3ArtifactStoreFromEnv(
	env: OfficialWebObjectStoreEnvironment = process.env,
): OfficialWebArtifactStore | undefined {
	const endpoint = env.OBJECT_STORE_ENDPOINT?.trim();
	const accessKey =
		env.OBJECT_STORE_SOURCE_ACCESS_KEY?.trim() || env.OBJECT_STORE_ACCESS_KEY?.trim();
	const secretKey =
		env.OBJECT_STORE_SOURCE_SECRET_KEY?.trim() || env.OBJECT_STORE_SECRET_KEY?.trim();
	const configuredCount = [endpoint, accessKey, secretKey].filter(Boolean).length;

	if (configuredCount === 0) {
		return undefined;
	}
	if (!endpoint || !accessKey || !secretKey) {
		throw new Error(
			"OBJECT_STORE_ENDPOINT plus a complete source-bucket credential pair are required. Use OBJECT_STORE_SOURCE_ACCESS_KEY/OBJECT_STORE_SOURCE_SECRET_KEY or shared OBJECT_STORE_ACCESS_KEY/OBJECT_STORE_SECRET_KEY.",
		);
	}

	return new S3ArtifactStore({
		bucket: env.OBJECT_STORE_BUCKET_SOURCE?.trim() || "campus-rag-source",
		client: new S3Client({
			endpoint,
			region: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
			credentials: {
				accessKeyId: accessKey,
				secretAccessKey: secretKey,
			},
			forcePathStyle: true,
		}),
	});
}
