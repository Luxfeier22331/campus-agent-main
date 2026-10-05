import { loadLocalInfrastructureSecrets } from "./infrastructure-secrets";
import type { LocalDevProfile } from "./profile";

export interface LocalQdrantConnection {
	apiKey: string;
	readOnlyApiKey: string;
	url: string;
}
export function localQdrantConnection(
	repoRoot: string,
	profile: LocalDevProfile,
): LocalQdrantConnection {
	const secrets = loadLocalInfrastructureSecrets(repoRoot, profile);
	return {
		apiKey: secrets.qdrantApiKey,
		readOnlyApiKey: secrets.qdrantReadOnlyApiKey,
		url: `http://127.0.0.1:${profile.infraPorts.qdrantHttp}`,
	};
}
export async function resolveLocalQdrantConnection(
	repoRoot: string,
	profile: LocalDevProfile,
): Promise<LocalQdrantConnection> {
	const connection = localQdrantConnection(repoRoot, profile);
	const { url, apiKey } = connection;
	let response: Response;
	try {
		response = await fetch(`${url}/collections`, {
			headers: { "api-key": apiKey },
			signal: AbortSignal.timeout(5_000),
		});
	} catch {
		throw new Error(`Cannot connect to local Qdrant at ${url}.`);
	}
	await response.body?.cancel();
	if (!response.ok) {
		throw new Error(`Local Qdrant credential check failed: HTTP ${response.status} at ${url}.`);
	}
	return connection;
}
