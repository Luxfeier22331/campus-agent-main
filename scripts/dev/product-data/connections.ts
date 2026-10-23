import { loadLocalInfrastructureSecrets } from "../lifecycle/infrastructure-secrets.ts";
import {
	calculateLocalDevInfrastructurePorts,
	type LocalDevProfile,
} from "../lifecycle/profile.ts";
export function localProductStoreEnv(repoRoot: string, profile: LocalDevProfile) {
	const ports = profile.infraPorts ?? calculateLocalDevInfrastructurePorts(profile.slot);
	const secrets = loadLocalInfrastructureSecrets(repoRoot, profile);
	const accessKey = secrets.objectStoreAccessKey;
	const secretKey = secrets.objectStoreSecretKey;
	return {
		OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
		OBJECT_STORE_ENDPOINT: `http://127.0.0.1:${ports.objectStore}`,
		OBJECT_STORE_DERIVED_ACCESS_KEY: accessKey,
		OBJECT_STORE_DERIVED_SECRET_KEY: secretKey,
		OBJECT_STORE_DERIVED_READ_ACCESS_KEY: accessKey,
		OBJECT_STORE_DERIVED_READ_SECRET_KEY: secretKey,
	};
}

/** Local source bucket as the rclone target for notice source closures. */
export function localSourceEndpoint(repoRoot: string, profile: LocalDevProfile) {
	const env = localProductStoreEnv(repoRoot, profile);
	return {
		endpoint: env.OBJECT_STORE_ENDPOINT,
		bucket: profile.sourceBucketName,
		accessKeyId: env.OBJECT_STORE_DERIVED_ACCESS_KEY,
		secretAccessKey: env.OBJECT_STORE_DERIVED_SECRET_KEY,
	};
}
