import {
	GetObjectCommand,
	type GetObjectCommandOutput,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { DERIVED_BUCKET } from "./shared";

export interface ObjectStoreClient {
	readTextObject(input: { bucket?: string; key: string }): Promise<string>;
	readOptionalBytesObject(input: { bucket?: string; key: string }): Promise<Uint8Array | undefined>;
	listObjectKeys(input: { bucket?: string; prefix: string }): Promise<string[]>;
	writeTextObject?(input: { bucket?: string; key: string; text: string }): Promise<void>;
}

export function createS3ObjectStore(): ObjectStoreClient {
	const endpoint = requiredEnv("OBJECT_STORE_ENDPOINT");
	const accessKeyId = requiredEnv("OBJECT_STORE_ACCESS_KEY");
	const secretAccessKey = requiredEnv("OBJECT_STORE_SECRET_KEY");
	const region = process.env.OBJECT_STORE_REGION?.trim() || "us-east-1";
	const client = new S3Client({
		credentials: { accessKeyId, secretAccessKey },
		endpoint,
		forcePathStyle: true,
		region,
	});
	return new S3ObjectStore(client);
}

class S3ObjectStore implements ObjectStoreClient {
	private readonly client: S3Client;

	constructor(client: S3Client) {
		this.client = client;
	}

	async readTextObject(input: { bucket?: string; key: string }): Promise<string> {
		const bytes = await this.readBytesObject(input);
		return new TextDecoder().decode(bytes);
	}

	async readOptionalBytesObject(input: {
		bucket?: string;
		key: string;
	}): Promise<Uint8Array | undefined> {
		try {
			return await this.readBytesObject(input);
		} catch (error) {
			if (isMissingObjectError(error)) {
				return;
			}
			throw error;
		}
	}

	async listObjectKeys(input: { bucket?: string; prefix: string }): Promise<string[]> {
		const bucket = input.bucket ?? DERIVED_BUCKET;
		const keys = new Set<string>();
		let continuationToken: string | undefined;
		do {
			const response = await this.client.send(
				new ListObjectsV2Command({
					Bucket: bucket,
					ContinuationToken: continuationToken,
					Prefix: input.prefix,
				}),
			);
			for (const item of response.Contents ?? []) {
				const key = item.Key?.trim();
				if (key) {
					keys.add(key);
				}
			}
			continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
		} while (continuationToken);
		return [...keys].sort();
	}

	async writeTextObject(input: { bucket?: string; key: string; text: string }): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Body: input.text,
				Bucket: input.bucket ?? DERIVED_BUCKET,
				ContentType: "application/json; charset=utf-8",
				Key: input.key,
			}),
		);
	}

	private async readBytesObject(input: { bucket?: string; key: string }): Promise<Uint8Array> {
		const bucket = input.bucket ?? DERIVED_BUCKET;
		let response: GetObjectCommandOutput;
		try {
			response = await this.client.send(
				new GetObjectCommand({
					Bucket: bucket,
					Key: input.key,
				}),
			);
		} catch (error) {
			throw enrichObjectStoreReadError(error, { bucket, key: input.key });
		}
		if (!response.Body) {
			throw new Error(`empty object body: ${input.key}`);
		}
		return response.Body.transformToByteArray();
	}
}

function enrichObjectStoreReadError(error: unknown, input: { bucket: string; key: string }): Error {
	const message = error instanceof Error ? error.message : String(error);
	const enriched = new Error(`failed to read object ${input.bucket}/${input.key}: ${message}`);
	if (error instanceof Error) {
		enriched.name = error.name;
		enriched.cause = error;
	}
	return enriched;
}

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for public-docs sync`);
	}
	return value;
}

function isMissingObjectError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const candidate = error as {
		name?: string;
		Code?: string;
		$metadata?: { httpStatusCode?: number };
	};
	return (
		candidate.name === "NoSuchKey" ||
		candidate.Code === "NoSuchKey" ||
		candidate.Code === "NotFound" ||
		candidate.$metadata?.httpStatusCode === 404
	);
}
