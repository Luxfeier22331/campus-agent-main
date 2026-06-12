import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

export function createS3ObjectStore() {
	const endpoint = requireEnv("OBJECT_STORE_ENDPOINT");
	const accessKeyId = requireEnv("OBJECT_STORE_ACCESS_KEY");
	const secretAccessKey = requireEnv("OBJECT_STORE_SECRET_KEY");
	const region = process.env.OBJECT_STORE_REGION?.trim() || "us-east-1";
	const bucket = resolvePublishedReaderObjectStoreBucket(process.env);
	const client = new S3Client({
		credentials: { accessKeyId, secretAccessKey },
		endpoint,
		forcePathStyle: true,
		region,
	});
	return {
		async readOptionalBytesObject(input) {
			try {
				const response = await client.send(
					new GetObjectCommand({ Bucket: bucket, Key: input.key }),
				);
				if (!response.Body) {
					throw new Error(`empty object body: ${input.key}`);
				}
				return response.Body.transformToByteArray();
			} catch (error) {
				if (isMissingObjectError(error)) {
					return;
				}
				throw error;
			}
		},
		async readTextObject(input) {
			const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: input.key }));
			if (!response.Body) {
				throw new Error(`empty object body: ${input.key}`);
			}
			return new TextDecoder().decode(await response.Body.transformToByteArray());
		},
	};
}

export function resolvePublishedReaderObjectStoreBucket(env) {
	return env.OBJECT_STORE_BUCKET_DERIVED?.trim() || "campus-rag-derived";
}

function isMissingObjectError(error) {
	return Boolean(
		error &&
			typeof error === "object" &&
			(error.name === "NoSuchKey" ||
				error.Code === "NoSuchKey" ||
				error.Code === "NotFound" ||
				error.$metadata?.httpStatusCode === 404),
	);
}

function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for campus docs published reader sync`);
	}
	return value;
}
