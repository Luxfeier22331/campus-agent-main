import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { OcrObjects } from "./types.ts";
export function createOcrObjects(env: NodeJS.ProcessEnv): OcrObjects {
	function required(key: string) {
		const value = env[key]?.trim();
		if (!value) {
			throw new Error(`${key} is required`);
		}
		return value;
	}
	const common = {
		endpoint: required("OBJECT_STORE_ENDPOINT"),
		region: env.OBJECT_STORE_REGION || "us-east-1",
		forcePathStyle: true,
		maxAttempts: 1,
	};
	const source = new S3Client({
		...common,
		credentials: {
			accessKeyId: required("OBJECT_STORE_SOURCE_ACCESS_KEY"),
			secretAccessKey: required("OBJECT_STORE_SOURCE_SECRET_KEY"),
		},
	});
	const derived = new S3Client({
		...common,
		credentials: {
			accessKeyId: required("OBJECT_STORE_DERIVED_ACCESS_KEY"),
			secretAccessKey: required("OBJECT_STORE_DERIVED_SECRET_KEY"),
		},
	});
	const sourceBucket = required("OBJECT_STORE_BUCKET_SOURCE");
	const derivedBucket = required("OBJECT_STORE_BUCKET_DERIVED");
	async function get(client: S3Client, bucket: string, key: string) {
		const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
			abortSignal: AbortSignal.timeout(60_000),
		});
		if (!response.Body) {
			throw new Error("OCR object body missing");
		}
		return response.Body.transformToByteArray();
	}
	return {
		getSource: (key) => get(source, sourceBucket, key),
		getDerived: (key) => get(derived, derivedBucket, key),
		async putDerived(key, body, contentType) {
			await derived.send(
				new PutObjectCommand({
					Bucket: derivedBucket,
					Key: key,
					Body: body,
					ContentType: contentType,
				}),
				{ abortSignal: AbortSignal.timeout(60_000) },
			);
		},
		async deleteDerived(key) {
			await derived.send(new DeleteObjectCommand({ Bucket: derivedBucket, Key: key }), {
				abortSignal: AbortSignal.timeout(60_000),
			});
		},
		close() {
			source.destroy();
			derived.destroy();
		},
	};
}
