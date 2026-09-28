import { HeadBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { LocalInfrastructureSecrets } from "./infrastructure-secrets";
import type { LocalDevProfile } from "./profile";

export type LocalResourceProbe = "present" | "missing" | "unknown";

export function createLocalObjectStoreClient(
	profile: LocalDevProfile,
	secrets: LocalInfrastructureSecrets,
): S3Client {
	return new S3Client({
		credentials: {
			accessKeyId: secrets.objectStoreAccessKey,
			secretAccessKey: secrets.objectStoreSecretKey,
		},
		endpoint: `http://127.0.0.1:${profile.infraPorts.objectStore}`,
		forcePathStyle: true,
		maxAttempts: 1,
		region: "us-east-1",
	});
}

export async function probeLocalBucket(
	profile: LocalDevProfile,
	secrets: LocalInfrastructureSecrets,
	bucketName: string,
): Promise<LocalResourceProbe> {
	try {
		await createLocalObjectStoreClient(profile, secrets).send(
			new HeadBucketCommand({ Bucket: bucketName }),
		);
		return "present";
	} catch (error) {
		return classifyObjectStoreError(error);
	}
}

export async function probeLocalObject(
	profile: LocalDevProfile,
	secrets: LocalInfrastructureSecrets,
	bucketName: string,
	objectKey: string,
): Promise<LocalResourceProbe> {
	try {
		await createLocalObjectStoreClient(profile, secrets).send(
			new HeadObjectCommand({ Bucket: bucketName, Key: objectKey }),
		);
		return "present";
	} catch (error) {
		return classifyObjectStoreError(error);
	}
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
