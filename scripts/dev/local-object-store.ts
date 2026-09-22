import { HeadBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { LocalResourceProbe } from "./shared-infrastructure";

const LOCAL_OBJECT_STORE_ENDPOINT = "http://127.0.0.1:9000";
const LOCAL_OBJECT_STORE_ACCESS_KEY = "rustfsadmin";
const LOCAL_OBJECT_STORE_SECRET_KEY = "rustfsadmin";
const LOCAL_OBJECT_STORE_REGION = "us-east-1";

let client: S3Client | undefined;

export async function probeLocalBucket(bucketName: string): Promise<LocalResourceProbe> {
	try {
		await getClient().send(new HeadBucketCommand({ Bucket: bucketName }));
		return "present";
	} catch (error) {
		return classifyObjectStoreError(error);
	}
}

export async function probeLocalObject(
	bucketName: string,
	objectKey: string,
): Promise<LocalResourceProbe> {
	try {
		await getClient().send(new HeadObjectCommand({ Bucket: bucketName, Key: objectKey }));
		return "present";
	} catch (error) {
		return classifyObjectStoreError(error);
	}
}

function getClient(): S3Client {
	if (client) {
		return client;
	}
	client = new S3Client({
		credentials: {
			accessKeyId: LOCAL_OBJECT_STORE_ACCESS_KEY,
			secretAccessKey: LOCAL_OBJECT_STORE_SECRET_KEY,
		},
		endpoint: LOCAL_OBJECT_STORE_ENDPOINT,
		forcePathStyle: true,
		maxAttempts: 1,
		region: LOCAL_OBJECT_STORE_REGION,
	});
	return client;
}

function classifyObjectStoreError(error: unknown): LocalResourceProbe {
	if (!error || typeof error !== "object") {
		return "unknown";
	}
	const value = error as { $metadata?: { httpStatusCode?: number }; name?: string };
	if (
		value.$metadata?.httpStatusCode === 404 ||
		value.name === "NotFound" ||
		value.name === "NoSuchBucket" ||
		value.name === "NoSuchKey"
	) {
		return "missing";
	}
	return "unknown";
}
