import {
	CopyObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

import type { Env } from "../../config";
import { AppApiRouteError } from "../../http";

export interface DiningFloorplanObjectRef {
	bucket: string;
	byteSize: number;
	contentType: string;
	objectKey: string;
	sha256: string;
}

export interface DiningFloorplanObjectStore {
	readonly bucket: string;

	copyObject(input: {
		sha256: string;
		sourceObjectKey: string;
		targetObjectKey: string;
	}): Promise<DiningFloorplanObjectRef>;
	headObject(input: { objectKey: string }): Promise<DiningFloorplanObjectRef | null>;
	putJson(input: { objectKey: string; value: unknown }): Promise<DiningFloorplanObjectRef>;
	putSvg(input: {
		objectKey: string;
		sha256: string;
		svgMarkup: string;
	}): Promise<DiningFloorplanObjectRef>;
}

type S3ClientLike = Pick<S3Client, "send">;

class S3DiningFloorplanObjectStore implements DiningFloorplanObjectStore {
	readonly bucket: string;
	private readonly client: S3ClientLike;

	constructor(input: { bucket: string; client: S3ClientLike }) {
		this.bucket = input.bucket;
		this.client = input.client;
	}

	async copyObject(input: {
		sha256: string;
		sourceObjectKey: string;
		targetObjectKey: string;
	}): Promise<DiningFloorplanObjectRef> {
		await this.client.send(
			new CopyObjectCommand({
				Bucket: this.bucket,
				CopySource: `${this.bucket}/${input.sourceObjectKey}`,
				Key: input.targetObjectKey,
				Metadata: {
					"content-sha256": input.sha256,
				},
				MetadataDirective: "REPLACE",
				ContentType: "image/svg+xml",
			}),
		);
		const head = await this.headObject({ objectKey: input.targetObjectKey });
		if (!head) {
			throw objectStoreFailure("Copied floorplan object was not found.", input.targetObjectKey);
		}
		assertStoredObjectSha256(head, input.sha256);
		return head;
	}

	async headObject(input: { objectKey: string }): Promise<DiningFloorplanObjectRef | null> {
		try {
			const result = await this.client.send(
				new HeadObjectCommand({
					Bucket: this.bucket,
					Key: input.objectKey,
				}),
			);
			const metadata = result.Metadata ?? {};
			const sha256 = metadata["content-sha256"] ?? metadata.content_sha256 ?? "";
			return {
				bucket: this.bucket,
				byteSize: result.ContentLength ?? 0,
				contentType: result.ContentType ?? "application/octet-stream",
				objectKey: input.objectKey,
				sha256,
			};
		} catch (error) {
			if (isNotFoundError(error)) {
				return null;
			}
			throw error;
		}
	}

	async putJson(input: { objectKey: string; value: unknown }): Promise<DiningFloorplanObjectRef> {
		const body = JSON.stringify(input.value);
		await this.client.send(
			new PutObjectCommand({
				Body: body,
				Bucket: this.bucket,
				ContentType: "application/json",
				Key: input.objectKey,
			}),
		);
		const head = await this.headObject({ objectKey: input.objectKey });
		if (!head) {
			throw objectStoreFailure("Stored JSON object was not found.", input.objectKey);
		}
		return head;
	}

	async putSvg(input: {
		objectKey: string;
		sha256: string;
		svgMarkup: string;
	}): Promise<DiningFloorplanObjectRef> {
		await this.client.send(
			new PutObjectCommand({
				Body: input.svgMarkup,
				Bucket: this.bucket,
				ContentType: "image/svg+xml",
				Key: input.objectKey,
				Metadata: {
					"content-sha256": input.sha256,
				},
			}),
		);
		const head = await this.headObject({ objectKey: input.objectKey });
		if (!head) {
			throw objectStoreFailure("Stored floorplan object was not found.", input.objectKey);
		}
		assertStoredObjectSha256(head, input.sha256);
		return head;
	}
}

export function createDiningFloorplanObjectStore(input: {
	bucket: string;
	client: S3ClientLike;
}): DiningFloorplanObjectStore {
	return new S3DiningFloorplanObjectStore(input);
}

export function createDiningFloorplanObjectStoreFromEnv(
	env: Env,
): DiningFloorplanObjectStore | null {
	const endpoint = env.OBJECT_STORE_ENDPOINT?.trim();
	const accessKey = (
		env.OBJECT_STORE_DERIVED_ACCESS_KEY ??
		env.OBJECT_STORE_ACCESS_KEY ??
		""
	).trim();
	const secretKey = (
		env.OBJECT_STORE_DERIVED_SECRET_KEY ??
		env.OBJECT_STORE_SECRET_KEY ??
		""
	).trim();
	const configuredCount = [endpoint, accessKey, secretKey].filter(Boolean).length;
	if (configuredCount === 0) {
		return null;
	}
	if (!(endpoint && accessKey && secretKey)) {
		throw new AppApiRouteError({
			code: "dining_floorplan_object_store_unavailable",
			message:
				"OBJECT_STORE_ENDPOINT plus derived object store credentials are required for dining floorplan uploads.",
			retryable: false,
			status: 503,
		});
	}
	return createDiningFloorplanObjectStore({
		bucket: env.OBJECT_STORE_BUCKET_DERIVED?.trim() || "campus-rag-derived",
		client: new S3Client({
			credentials: {
				accessKeyId: accessKey,
				secretAccessKey: secretKey,
			},
			endpoint,
			forcePathStyle: true,
			region: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
		}),
	});
}

function assertStoredObjectSha256(object: DiningFloorplanObjectRef, expectedSha256: string): void {
	if (object.sha256 && object.sha256 !== expectedSha256) {
		throw objectStoreFailure("Stored floorplan checksum mismatch.", object.objectKey);
	}
}

function isNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const record = error as { $metadata?: { httpStatusCode?: number }; name?: string };
	return record.name === "NotFound" || record.$metadata?.httpStatusCode === 404;
}

function objectStoreFailure(message: string, objectKey: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "dining_floorplan_object_store_error",
		details: { objectKey },
		message,
		retryable: false,
		status: 502,
	});
}
