import { captureCommandResult } from "./process";

const QDRANT_CONTAINER = "campus-agent-local-qdrant-qdrant-1";

export interface LocalQdrantConnection {
	apiKey: string;
	readOnlyApiKey: string;
	url: string;
}

interface QdrantContainerInspection {
	Config: { Env: string[] };
	NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> };
	State: { Running: boolean };
}

export async function resolveLocalQdrantConnection(
	capture: typeof captureCommandResult = captureCommandResult,
): Promise<LocalQdrantConnection> {
	const result = capture("docker", ["inspect", QDRANT_CONTAINER]);
	if (result.error || result.status !== 0) {
		throw new Error(
			"Cannot inspect local Qdrant; start infra/local/docker-compose.qdrant.yml before initializing campus-rag-index-publisher.",
		);
	}
	const [container] = JSON.parse(result.stdout) as QdrantContainerInspection[];
	if (!container?.State.Running) {
		throw new Error("Local Qdrant is not running; start infra/local/docker-compose.qdrant.yml.");
	}
	const keyPrefix = "QDRANT__SERVICE__API_KEY=";
	const apiKey = container.Config.Env.find((value) => value.startsWith(keyPrefix))?.slice(
		keyPrefix.length,
	);
	if (!apiKey) {
		throw new Error("Local Qdrant does not configure QDRANT__SERVICE__API_KEY for its writer.");
	}
	const readOnlyKeyPrefix = "QDRANT__SERVICE__READ_ONLY_API_KEY=";
	const readOnlyApiKey = container.Config.Env.find((value) =>
		value.startsWith(readOnlyKeyPrefix),
	)?.slice(readOnlyKeyPrefix.length);
	if (!readOnlyApiKey) {
		throw new Error(
			"Local Qdrant does not configure QDRANT__SERVICE__READ_ONLY_API_KEY for online retrieval.",
		);
	}
	const binding = container.NetworkSettings.Ports["6333/tcp"]?.find((port) =>
		["127.0.0.1", "0.0.0.0"].includes(port.HostIp),
	);
	if (!binding) {
		throw new Error("Local Qdrant does not publish its HTTP port on IPv4 loopback.");
	}
	const url = `http://127.0.0.1:${binding.HostPort}`;
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
	return { apiKey, readOnlyApiKey, url };
}
