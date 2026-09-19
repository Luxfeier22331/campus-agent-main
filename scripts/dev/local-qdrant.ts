import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { captureCommandResult, runCommand } from "./process";
import { resolveLocalDevRegistryPath } from "./profile";

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
			"Cannot inspect local Qdrant; run pnpm dev:shared-reconcile from the canonical checkout.",
		);
	}
	const [container] = JSON.parse(result.stdout) as QdrantContainerInspection[];
	if (!container?.State.Running) {
		throw new Error(
			"Local Qdrant is not running; run pnpm dev:shared-reconcile from the canonical checkout.",
		);
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

export async function reconcileLocalQdrant(repoRoot: string): Promise<void> {
	const path = resolve(dirname(resolveLocalDevRegistryPath(repoRoot)), "qdrant.env");
	const inspection = captureCommandResult("docker", ["inspect", QDRANT_CONTAINER]);
	let apiKey: string;
	let readOnlyApiKey: string;
	if (inspection.status === 0) {
		const [container] = JSON.parse(inspection.stdout) as QdrantContainerInspection[];
		const env = Object.fromEntries(
			(container?.Config.Env ?? []).map((entry) => {
				const index = entry.indexOf("=");
				return [entry.slice(0, index), entry.slice(index + 1)];
			}),
		);
		apiKey = env.QDRANT__SERVICE__API_KEY ?? "";
		readOnlyApiKey = env.QDRANT__SERVICE__READ_ONLY_API_KEY ?? "";
		if (!(apiKey && readOnlyApiKey)) {
			throw new Error("Existing Qdrant credentials are incomplete; refusing key rotation");
		}
	} else if (existsSync(path)) {
		const env = Object.fromEntries(
			readFileSync(path, "utf8")
				.trim()
				.split("\n")
				.map((line) => line.split("=")),
		);
		apiKey = env.QDRANT_API_KEY ?? "";
		readOnlyApiKey = env.QDRANT_READ_ONLY_API_KEY ?? "";
		if (!(apiKey && readOnlyApiKey)) {
			throw new Error("Saved Qdrant credentials are incomplete");
		}
	} else {
		if (!/No such object|No such container/u.test(inspection.stderr)) {
			throw new Error("Cannot inspect existing Qdrant");
		}
		apiKey = randomBytes(32).toString("hex");
		readOnlyApiKey = randomBytes(32).toString("hex");
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `QDRANT_API_KEY=${apiKey}\nQDRANT_READ_ONLY_API_KEY=${readOnlyApiKey}\n`, {
		mode: 0o600,
	});
	chmodSync(path, 0o600);
	runCommand(
		"docker",
		[
			"compose",
			"--env-file",
			path,
			"-f",
			"infra/local/docker-compose.qdrant.yml",
			"up",
			"-d",
			"--wait",
		],
		{
			cwd: repoRoot,
			timeout: 120_000,
			env: { ...process.env, QDRANT_API_KEY: apiKey, QDRANT_READ_ONLY_API_KEY: readOnlyApiKey },
		},
	);
	await resolveLocalQdrantConnection();
}
