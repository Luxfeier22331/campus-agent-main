import {
	loadLocalInfrastructureSecrets,
	resolveLocalInfrastructureSecretsPath,
} from "./infrastructure-secrets";
import type { LocalDevProfile } from "./profile";

export interface LocalQdrantConnection {
	apiKey: string;
	readOnlyApiKey: string;
	url: string;
}
export async function resolveLocalQdrantConnection(
	repoRoot: string,
	profile: LocalDevProfile,
): Promise<LocalQdrantConnection>;
export async function resolveLocalQdrantConnection(
	repoRoot: string,
	profile: LocalDevProfile,
): Promise<LocalQdrantConnection> {
	const secrets = loadLocalInfrastructureSecrets(repoRoot, profile);
	const url = `http://127.0.0.1:${profile.infraPorts.qdrantHttp}`;
	let response: Response;
	try {
		response = await fetch(`${url}/collections`, {
			headers: { "api-key": secrets.qdrantApiKey },
			signal: AbortSignal.timeout(5_000),
		});
	} catch {
		throw new Error(`Cannot connect to local Qdrant at ${url}.`);
	}
	await response.body?.cancel();
	if (!response.ok) {
		throw new Error(`Local Qdrant credential check failed: HTTP ${response.status} at ${url}.`);
	}
	return { apiKey: secrets.qdrantApiKey, readOnlyApiKey: secrets.qdrantReadOnlyApiKey, url };
}

export function localQdrantComposeArgs(profile: LocalDevProfile, repoRoot: string): string[] {
	return [
		"compose",
		"--project-name",
		profile.infraProject,
		"--env-file",
		resolveLocalInfrastructureSecretsPath(repoRoot, profile),
		"-f",
		"infra/local/docker-compose.dev.yml",
	];
}
