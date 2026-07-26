import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface DiningFloorplanAsset {
	objectKey: string;
	sha256: `sha256:${string}`;
	svgAssetUrl: string;
}

export interface DiningFloorplanAssetStore {
	putSvg(input: { sha256: `sha256:${string}`; svgMarkup: string }): Promise<DiningFloorplanAsset>;
	verifyReadiness(): Promise<void>;
}

export interface DiningFloorplanAssetStoreEnv {
	OBJECT_STORE_BUCKET_DERIVED?: string;
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_ENDPOINT?: string;
}

export function createDiningFloorplanAssetStoreFromEnv(
	env: DiningFloorplanAssetStoreEnv,
): DiningFloorplanAssetStore {
	const endpoint = required(env.OBJECT_STORE_ENDPOINT, "endpoint");
	const bucket = env.OBJECT_STORE_BUCKET_DERIVED?.trim() || "campus-agent-derived";
	const client = new S3Client({
		credentials: {
			accessKeyId: required(env.OBJECT_STORE_DERIVED_ACCESS_KEY, "derived access key"),
			secretAccessKey: required(env.OBJECT_STORE_DERIVED_SECRET_KEY, "derived secret key"),
		},
		endpoint,
		forcePathStyle: true,
		region: "us-east-1",
	});
	return createS3DiningFloorplanAssetStore({ bucket, client });
}

export function createS3DiningFloorplanAssetStore(input: {
	bucket: string;
	client: Pick<S3Client, "send">;
}): DiningFloorplanAssetStore {
	return {
		async putSvg({ sha256, svgMarkup }) {
			const digest = digestFromSha256(sha256);
			const objectKey = `dining/floorplans/${digest}.svg`;
			try {
				await input.client.send(
					new PutObjectCommand({
						Body: svgMarkup,
						Bucket: input.bucket,
						CacheControl: "public, max-age=31536000, immutable",
						ContentType: "image/svg+xml; charset=utf-8",
						IfNoneMatch: "*",
						Key: objectKey,
						Metadata: { sha256: digest },
					}),
				);
			} catch (error) {
				if (!isPreconditionFailure(error)) {
					throw error;
				}
			}
			return {
				objectKey,
				sha256,
				svgAssetUrl: `/api/dining/floorplans/${digest}.svg`,
			};
		},
		async verifyReadiness() {
			// The first immutable write is the authoritative availability check. Avoid probe objects.
		},
	};
}

export function createUnavailableDiningFloorplanAssetStore(
	error: unknown,
): DiningFloorplanAssetStore {
	const unavailable = async (): Promise<never> => {
		throw new Error("Dining floorplan object storage is unavailable.", { cause: error });
	};
	return { putSvg: unavailable, verifyReadiness: unavailable };
}

function digestFromSha256(value: `sha256:${string}`): string {
	const digest = /^sha256:([0-9a-f]{64})$/.exec(value)?.[1];
	if (!digest) {
		throw new Error("Dining floorplan SHA-256 is invalid.");
	}
	return digest;
}

function required(value: string | undefined, label: string): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error(`Dining floorplan object store ${label} is required.`);
	}
	return normalized;
}

function isPreconditionFailure(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			("$metadata" in error
				? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412
				: false),
	);
}
