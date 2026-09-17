import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DiningStoreUnavailableError } from "./dining-store-errors.ts";

export interface DiningSubmissionAssetEnv {
	OBJECT_STORE_BUCKET_DERIVED?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_DERIVED_READ_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_READ_SECRET_KEY?: string;
}
export interface DiningSubmissionAssetStore {
	get(key: string): Promise<Uint8Array | null>;
}

export function createDiningSubmissionAssetStoreFromEnv(
	env: DiningSubmissionAssetEnv,
): DiningSubmissionAssetStore {
	// Initialize only when a photo is requested: missing media credentials do not disable moderation.
	// The client is reused across requests; process env is stable for the server's lifetime.
	let cached: { bucket: string; client: S3Client } | null = null;
	function resolve() {
		if (cached) {
			return cached;
		}
		const endpoint = env.OBJECT_STORE_ENDPOINT?.trim();
		const accessKeyId = env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY?.trim();
		const secretAccessKey = env.OBJECT_STORE_DERIVED_READ_SECRET_KEY?.trim();
		if (!(endpoint && accessKeyId && secretAccessKey)) {
			throw new DiningStoreUnavailableError("投稿图片只读存储未配置。");
		}
		cached = {
			bucket: env.OBJECT_STORE_BUCKET_DERIVED?.trim() || "campus-agent-derived",
			client: new S3Client({
				endpoint,
				credentials: { accessKeyId, secretAccessKey },
				forcePathStyle: true,
				region: "us-east-1",
				maxAttempts: 1,
			}),
		};
		return cached;
	}
	return {
		async get(key) {
			const { bucket, client } = resolve();
			return createS3DiningSubmissionAssetStore({ bucket, client }).get(key);
		},
	};
}

export function createS3DiningSubmissionAssetStore(input: {
	bucket: string;
	client: Pick<S3Client, "send">;
}): DiningSubmissionAssetStore {
	return {
		async get(key) {
			if (!/^dining\/submissions\/[A-Za-z0-9_-]+\.webp$/.test(key)) {
				throw new DiningStoreUnavailableError("投稿图片引用无效。");
			}
			try {
				const response = await input.client.send(
					new GetObjectCommand({ Bucket: input.bucket, Key: key }),
				);
				if (!response.Body) {
					throw new Error("Empty object body");
				}
				return await response.Body.transformToByteArray();
			} catch (error) {
				if (error && typeof error === "object" && "name" in error && error.name === "NoSuchKey") {
					return null;
				}
				throw new DiningStoreUnavailableError("投稿图片读取失败。", { cause: error });
			}
		},
	};
}
