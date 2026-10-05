import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { parseEnv } from "node:util";
import { type DataDomain, diagnoseDomains } from "../product-data/domains";
import { type BootstrapProbeResult, probeLocalBootstrapStep } from "./application-bootstrap";
import {
	isLocalManagedFile,
	isPrivateLocalFile,
	managedLocalEnvironmentPathsForProjections,
	resolveLocalModelConfigEncryptionKeyPath,
} from "./environment";
import { probeLocalTemporalNamespace } from "./instance-resources";
import { inspectLocalInfrastructure } from "./local-infrastructure";
import { calculateLocalDevRuntimePorts, loadLocalDevProfile } from "./profile";
import { type LocalDevTarget, resolveLocalDevTargetPlan } from "./targets";

export type LocalDoctorScope = "config" | "infra" | "schema" | "data" | "startup" | "runtime";
const REQUIRED_ENV_KEYS: Record<string, string[]> = {
	"apps/app-api/.env.local": [
		"APP_API_SCHEMA_DATABASE_URL",
		"CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB",
		"PORT",
	],
	"apps/app-api/.dev.vars.local": [
		"APP_API_EXECUTION_SHARED_SECRET",
		"APP_API_SAFETY_IDENTIFIER_HMAC_SECRET",
		"BETTER_AUTH_SECRET",
		"OBJECT_STORE_LOCAL_BASE_URL",
	],
	"apps/campus-web/.dev.vars.local": [
		"APP_API_BASE_URL",
		"CAMPUS_WEB_DEV_PORT",
		"OBJECT_STORE_BUCKET_DERIVED",
	],
	"apps/execution-control/.env.local": [
		"EXECUTION_CONTROL_DATABASE_URL",
		"EXECUTION_CONTROL_TEMPORAL_ADDRESS",
		"PORT",
	],
	"apps/model-config/.env.local": [
		"MODEL_CONFIG_DATABASE_URL",
		"MODEL_CONFIG_ENCRYPTION_KEY_FILE",
		"MODEL_CONFIG_PORT",
	],
	"apps/agent-runtime/.env.local": ["AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL", "PORT"],
	"apps/ops-web/.env.local": [
		"OPS_WEB_DATABASE_URL",
		"OPS_WEB_INTERNAL_TOKEN",
		"OPS_WEB_PUBLIC_ORIGIN",
		"TEMPORAL_ADDRESS",
	],
	"jobs/document-ocr/.env.local": [
		"MODEL_CONFIG_URL",
		"NOTICES_DATABASE_URL",
		"OBJECT_STORE_BUCKET_SOURCE",
	],
	"jobs/notice-classifier/.env.local": ["MODEL_CONFIG_URL", "NOTICES_DATABASE_URL"],
	"jobs/notice-publisher/.env.local": ["NOTICES_DATABASE_URL", "OBJECT_STORE_BUCKET_SOURCE"],
	"jobs/internal-portal-collection/adapters/internal-portal/.env.local": [
		"NOTICES_DATABASE_URL",
		"OBJECT_STORE_BUCKET_SOURCE",
		"OPS_WEB_INTERNAL_TOKEN",
	],
	"jobs/campus-docs-index-publisher/.env.local": [
		"EXECUTION_CONTROL_DATABASE_URL",
		"OBJECT_STORE_BUCKET_DERIVED",
	],
	"apps/notice-pipeline-worker/.env.local": [
		"MODEL_CONFIG_URL",
		"TEMPORAL_ADDRESS",
		"OBJECT_STORE_BUCKET_SOURCE",
	],
	"apps/notice-artifacts-worker/.env.local": ["MODEL_CONFIG_URL", "TEMPORAL_ADDRESS", "QDRANT_URL"],
	"jobs/campus-rag-index-publisher/.env.local": ["EXECUTION_CONTROL_DATABASE_URL", "QDRANT_URL"],
	"jobs/notice-index-publisher/.env.local": ["NOTICES_DATABASE_URL"],
};
export async function diagnoseLocalDevelopment(
	repoRoot: string,
	target: LocalDevTarget = "core",
	scope: LocalDoctorScope = "config",
	domains: DataDomain[] = [],
) {
	if (scope === "data" && domains.length === 0) {
		throw new Error("Data diagnosis requires --domain.");
	}
	const profile = loadLocalDevProfile(repoRoot);
	const plan = resolveLocalDevTargetPlan(target);
	const checks: Record<string, BootstrapProbeResult> = {};
	const capture = async (name: string, fn: () => Promise<BootstrapProbeResult>) => {
		try {
			checks[name] = await fn();
		} catch (e) {
			checks[name] = { state: "unknown", reason: e instanceof Error ? e.message : String(e) };
		}
	};
	if (["config", "startup", "runtime"].includes(scope)) {
		for (const path of managedLocalEnvironmentPathsForProjections(
			repoRoot,
			plan.environmentProjections,
		)) {
			if (!(existsSync(path) && isLocalManagedFile(path))) {
				checks[path] = { state: "missing" };
				continue;
			}
			const values = parseEnv(readFileSync(path, "utf8"));
			const required = REQUIRED_ENV_KEYS[relative(repoRoot, path).replaceAll("\\", "/")] ?? [];
			const missing = required.filter((key) => !values[key]?.trim());
			if (missing.length > 0) {
				checks[path] = { state: "missing", reason: `Missing configuration: ${missing.join(", ")}` };
				continue;
			}
			const mismatched = Object.entries(values)
				.filter(([key, value]) => {
					if (typeof value !== "string") {
						return false;
					}
					if (
						key.endsWith("DATABASE_URL") ||
						key === "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB"
					) {
						try {
							const url = new URL(value);
							return (
								url.hostname !== "127.0.0.1" ||
								Number(url.port) !== profile.infraPorts.postgres ||
								decodeURIComponent(url.pathname.slice(1)) !== profile.databaseName
							);
						} catch {
							return true;
						}
					}
					const identities: Record<string, string> = {
						OBJECT_STORE_BUCKET_SOURCE: profile.sourceBucketName,
						OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
						OBJECT_STORE_ENDPOINT: `http://127.0.0.1:${profile.infraPorts.objectStore}`,
						TEMPORAL_ADDRESS: `127.0.0.1:${profile.infraPorts.temporal}`,
						EXECUTION_CONTROL_TEMPORAL_ADDRESS: `127.0.0.1:${profile.infraPorts.temporal}`,
						TEMPORAL_NAMESPACE: `campus-agent-local-${profile.instanceId}`,
						EXECUTION_CONTROL_TEMPORAL_NAMESPACE: `campus-agent-local-${profile.instanceId}`,
						QDRANT_URL: `http://127.0.0.1:${profile.infraPorts.qdrantHttp}`,
					};
					return key in identities && value !== identities[key];
				})
				.map(([key]) => key);
			checks[path] =
				mismatched.length > 0
					? {
							state: "invalid",
							reason: `Configuration does not match this worktree: ${mismatched.join(", ")}`,
						}
					: { state: "ready" };
		}
		if (plan.environmentProjections.some((p) => p === "core" || p === "model-config")) {
			const path = resolveLocalModelConfigEncryptionKeyPath(repoRoot);
			checks["model-config-key"] = {
				state: existsSync(path) && isPrivateLocalFile(path) ? "ready" : "missing",
			};
		}
	}
	if (["infra", "startup", "runtime"].includes(scope)) {
		await capture("infrastructure", async () => {
			const caps = [
				...plan.capabilities,
				...(scope === "runtime" && target === "core" ? ["hindsight" as const] : []),
			];
			const result = await inspectLocalInfrastructure(repoRoot, profile, caps);
			return {
				state:
					result.status === "ready" ? "ready" : result.status === "missing" ? "missing" : "unknown",
				...(result.status === "ready" ? {} : { reason: JSON.stringify(result.capabilities) }),
			};
		});
		if (plan.capabilities.includes("temporal")) {
			await capture("temporal-namespace", async () => ({
				state:
					(await probeLocalTemporalNamespace(repoRoot, profile)) === "present"
						? "ready"
						: "missing",
			}));
		}
	}
	if (["schema", "startup", "runtime"].includes(scope)) {
		for (const step of plan.bootstrapSteps.filter((s) => s !== "temporal-namespace")) {
			await capture(step, () =>
				probeLocalBootstrapStep(repoRoot, profile, step, plan.modelConfigNames),
			);
		}
	}
	if (scope === "data") {
		Object.assign(checks, await diagnoseDomains(repoRoot, profile, domains));
	}
	if (scope === "startup" && target === "core") {
		Object.assign(checks, await diagnoseDomains(repoRoot, profile, ["docs"]));
	}
	if (scope === "runtime") {
		if (plan.modelConfigNames.length > 0) {
			await capture("models", () =>
				probeLocalBootstrapStep(repoRoot, profile, "model-config-check", plan.modelConfigNames),
			);
		}
		if (target === "core") {
			Object.assign(checks, await diagnoseDomains(repoRoot, profile, ["retrieval"]));
		}
		const rp = calculateLocalDevRuntimePorts(profile.slot);
		const endpoints = new Map<string, number>();
		for (const dependency of plan.runtimeDependencies) {
			if (dependency === "core") {
				for (const [name, port] of Object.entries({
					"app-api": profile.ports.appApi,
					"campus-web": profile.ports.campusWeb,
					"execution-control": rp.executionControl,
					"execution-worker": rp.executionWorker,
					"model-config": rp.modelConfig,
					"agent-runtime": rp.agentRuntime,
				})) {
					endpoints.set(name, port);
				}
			} else {
				endpoints.set(
					dependency,
					dependency === "app-api"
						? profile.ports.appApi
						: dependency === "ops-web"
							? profile.ports.opsWebApi
							: rp.modelConfig,
				);
			}
		}
		for (const [name, port] of endpoints) {
			await capture(name, async () => {
				const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
					signal: AbortSignal.timeout(2000),
				});
				await response.body?.cancel();
				return { state: response.ok ? "ready" : "missing" };
			});
		}
	}
	const states = Object.values(checks).map((c) => c.state);
	return {
		target,
		scope,
		checks,
		status: states.includes("invalid")
			? "invalid"
			: states.includes("unknown")
				? "unknown"
				: states.includes("missing")
					? "incomplete"
					: "ready",
	};
}
