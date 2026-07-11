import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { parseEnvFile } from "../lib/env-file.ts";
import { type Env, type Surface, surfaceSpecs } from "./specs.ts";

export interface BootstrapState {
	candidate_path: string;
	file_found: boolean;
	loaded_keys: string[];
	loaded_path: string | null;
	skipped_existing_keys: string[];
}

export interface Status {
	bootstrap: BootstrapState & { ran: true };
	conditions: Record<string, Record<string, unknown>>;
	files: Record<string, Record<string, unknown>>;
	overall_ready: boolean;
	postgres: { shared: Record<string, unknown> };
	provider_projection: Record<string, unknown>;
	providers: Record<string, Record<string, unknown>>;
	runtime_config: Record<string, unknown>;
	settings: {
		optional: Record<string, Record<string, unknown>>;
		required: Record<string, Record<string, unknown>>;
	};
	surface: string;
}

export function collectEnvDoctorStatus({
	checkPostgresConnectivity = false,
	env = process.env,
	root,
	surface,
}: {
	checkPostgresConnectivity?: boolean;
	env?: Env;
	root: string;
	surface: string;
}): Status {
	const normalizedSurface = surface.trim().toLowerCase();
	if (!Object.hasOwn(surfaceSpecs, normalizedSurface)) {
		throw new Error(
			`unsupported surface ${surface}; expected one of ${Object.keys(surfaceSpecs).sort().join(", ")}`,
		);
	}
	const resolvedRoot = resolve(root);
	const originalEnv = { ...env };
	const currentEnv = { ...env };
	const bootstrap = loadRepoEnv(resolvedRoot, currentEnv);
	const spec = surfaceSpecs[normalizedSurface as Surface];
	const providers =
		normalizedSurface === "evals"
			? {}
			: Object.fromEntries(
					Object.entries(spec.providers).map(([name, providerSpec]) => [
						name,
						collectProviderStatus(currentEnv, providerSpec.surface_name, providerSpec.checked_keys),
					]),
				);
	const requiredSettings = Object.fromEntries(
		Object.entries(spec.required_settings).map(([name, checkedKeys]) => [
			name,
			name === "object_store_credentials"
				? collectObjectStoreCredentialsStatus(currentEnv)
				: collectSettingStatus(currentEnv, checkedKeys, true),
		]),
	);
	const optionalSettings = Object.fromEntries(
		Object.entries(spec.optional_settings).map(([name, checkedKeys]) => [
			name,
			collectSettingStatus(currentEnv, checkedKeys, false),
		]),
	);
	const files = Object.fromEntries(
		Object.entries(spec.files).map(([relativePath, fileSpec]) => [
			relativePath,
			collectEnvFileStatus(
				resolvedRoot,
				relativePath,
				fileSpec.required_keys ?? [],
				fileSpec.optional_keys ?? [],
			),
		]),
	);
	const postgres = {
		shared: collectSharedPostgresStatus({
			bootstrap,
			checkConnectivity: checkPostgresConnectivity,
			currentEnv,
			originalEnv,
		}),
	};
	const runtimeConfig = collectExecutionControlRuntimeConfigStatus(
		resolvedRoot,
		currentEnv,
		normalizedSurface,
	);
	const conditions = collectSurfaceConditions({
		env: currentEnv,
		runtimeConfig,
		settings: { optional: optionalSettings, required: requiredSettings },
		surface: normalizedSurface,
	});
	const overallReady =
		Object.values(providers).every((status) => status.present === true) &&
		Object.values(requiredSettings).every((status) => status.present === true) &&
		Object.values(files).every((status) => status.ready === true) &&
		postgresDiagnosticsReady(postgres, checkPostgresConnectivity) &&
		Object.values(conditions).every((condition) => condition.ready === true);
	return {
		surface: normalizedSurface,
		overall_ready: overallReady,
		bootstrap: { ran: true, ...bootstrap },
		providers,
		provider_projection: {},
		settings: { required: requiredSettings, optional: optionalSettings },
		conditions,
		runtime_config: runtimeConfig,
		postgres,
		files,
	};
}

export function renderTextReport(status: Status): string {
	const lines = [
		`surface=${status.surface}`,
		`overall_ready=${status.overall_ready}`,
		`bootstrap.file_found=${status.bootstrap.file_found}`,
		`bootstrap.loaded_path=${status.bootstrap.loaded_path}`,
	];
	const postgres = status.postgres.shared;
	lines.push(
		`postgres.shared.present=${postgres.present} resolved_key=${postgres.resolved_key}`,
		`postgres.shared.shell_exported=${postgres.shell_exported}`,
		`postgres.shared.repo_env_loaded=${postgres.repo_env_loaded}`,
		`postgres.shared.source=${postgres.source}`,
	);
	const connectivity = isRecord(postgres.connectivity) ? postgres.connectivity : {};
	lines.push(`postgres.shared.connectivity.checked=${connectivity.checked} ok=${connectivity.ok}`);
	if (connectivity.error) {
		lines.push(
			`postgres.shared.connectivity.error=${connectivity.error_class}: ${connectivity.error}`,
		);
	}
	for (const [providerName, providerStatus] of Object.entries(status.providers)) {
		lines.push(
			`provider.${providerName}.present=${providerStatus.present} resolved_key=${providerStatus.resolved_key}`,
			`provider.${providerName}.checked_keys=${(providerStatus.checked_keys as string[]).join(",")}`,
		);
		if (providerStatus.error) {
			lines.push(`provider.${providerName}.error=${providerStatus.error}`);
		}
	}
	for (const group of ["required", "optional"] as const) {
		for (const [settingName, settingStatus] of Object.entries(status.settings[group])) {
			lines.push(
				`setting.${settingName}.present=${settingStatus.present} resolved_key=${settingStatus.resolved_key}`,
			);
			if (settingStatus.error && settingStatus.required) {
				lines.push(`setting.${settingName}.error=${settingStatus.error}`);
			}
		}
	}
	for (const [conditionName, conditionStatus] of Object.entries(status.conditions)) {
		lines.push(
			`condition.${conditionName}.required=${conditionStatus.required} ready=${conditionStatus.ready}`,
		);
		if (conditionStatus.error) {
			lines.push(`condition.${conditionName}.error=${conditionStatus.error}`);
		}
	}
	for (const [relativePath, fileStatus] of Object.entries(status.files)) {
		lines.push(
			`file.${relativePath}.ready=${fileStatus.ready}`,
			`file.${relativePath}.file_found=${fileStatus.file_found}`,
			`file.${relativePath}.required_keys=${(fileStatus.required_keys as string[]).join(",")}`,
		);
		if (Array.isArray(fileStatus.missing_keys) && fileStatus.missing_keys.length > 0) {
			lines.push(`file.${relativePath}.missing_keys=${fileStatus.missing_keys.join(",")}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

function loadRepoEnv(root: string, env: Env): BootstrapState {
	const candidatePath = join(root, ".env");
	if (!existsSync(candidatePath)) {
		return {
			candidate_path: candidatePath,
			file_found: false,
			loaded_keys: [],
			loaded_path: null,
			skipped_existing_keys: [],
		};
	}
	const values = parseEnvFile(candidatePath);
	const loadedKeys: string[] = [];
	const skippedExistingKeys: string[] = [];
	for (const [key, value] of Object.entries(values)) {
		if (env[key]?.trim()) {
			skippedExistingKeys.push(key);
			continue;
		}
		env[key] = value;
		loadedKeys.push(key);
	}
	return {
		candidate_path: candidatePath,
		file_found: true,
		loaded_keys: loadedKeys,
		loaded_path: candidatePath,
		skipped_existing_keys: skippedExistingKeys,
	};
}

function collectSharedPostgresStatus({
	bootstrap,
	checkConnectivity,
	currentEnv,
	originalEnv,
}: {
	bootstrap: BootstrapState;
	checkConnectivity: boolean;
	currentEnv: Env;
	originalEnv: Env;
}): Record<string, unknown> {
	const key = "CAMPUS_SHARED_POSTGRES_URL";
	const shellExported = Boolean(originalEnv[key]?.trim());
	const present = Boolean(currentEnv[key]?.trim());
	const repoEnvLoaded = bootstrap.loaded_keys.includes(key);
	const repoEnvSkippedExisting = bootstrap.skipped_existing_keys.includes(key);
	let source = "missing";
	if (present && shellExported) {
		source = "shell_env";
	} else if (present && repoEnvLoaded) {
		source = "repo_env";
	} else if (present) {
		source = "process_env_after_bootstrap";
	}
	return {
		present,
		checked_keys: [key],
		resolved_key: present ? key : null,
		shell_exported: shellExported,
		repo_env_loaded: repoEnvLoaded,
		repo_env_skipped_existing: repoEnvSkippedExisting,
		source,
		connectivity: collectPostgresConnectivity(currentEnv, key, checkConnectivity),
	};
}

function collectPostgresConnectivity(
	env: Env,
	key: string,
	checkConnectivity: boolean,
): Record<string, unknown> {
	if (!checkConnectivity) {
		return { checked: false, ok: null, error: null, error_class: null };
	}
	if (!env[key]?.trim()) {
		return {
			checked: true,
			ok: false,
			error: `${key} is not present after repo env bootstrap`,
			error_class: "MissingDatabaseURL",
		};
	}
	return {
		checked: true,
		ok: false,
		error:
			"TypeScript Postgres connectivity probe is retired; use the TS/Go database owner readiness checks instead",
		error_class: "TypeScriptPostgresProbeRetired",
	};
}

function collectSurfaceConditions(input: {
	env: Env;
	runtimeConfig: Record<string, unknown>;
	settings: Status["settings"];
	surface: string;
}): Record<string, Record<string, unknown>> {
	if (input.surface !== "execution-control") {
		return {};
	}
	return {
		runtime_config_contract: {
			required: true,
			ready: input.runtimeConfig.ready === true,
			error: input.runtimeConfig.error ?? null,
		},
		execution_audit_contract: executionAuditContract(input.runtimeConfig, input.settings.optional),
		otel_axiom_collector_endpoint_contract: axiomCollectorEndpointContract(input.env),
	};
}

function executionAuditContract(
	runtimeConfig: Record<string, unknown>,
	optionalSettings: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
	const config = isRecord(runtimeConfig.config) ? runtimeConfig.config : {};
	const executionAudit = isRecord(config.execution_audit) ? config.execution_audit : {};
	const required = executionAudit.enabled === true;
	const missing = required
		? [
				["execution_audit_url", "EXECUTION_CONTROL_EXECUTION_AUDIT_URL"],
				["execution_audit_shared_secret", "EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET"],
			]
				.filter(([setting]) => !settingPresent(optionalSettings, setting))
				.map(([, key]) => key)
		: [];
	return {
		required,
		ready: missing.length === 0,
		error: missing.length > 0 ? `execution audit enabled but missing ${missing.join(" / ")}` : null,
	};
}
function axiomCollectorEndpointContract(env: Env): Record<string, unknown> {
	const endpoint = env.OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT?.trim() ?? "";
	const endpointWithoutProtocol = endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
	const ready =
		(!endpoint || /^https?:\/\//.test(endpoint)) && !endpointWithoutProtocol.includes("/");
	return {
		required: Boolean(endpoint),
		ready,
		error:
			endpoint && !ready
				? "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT must be a base domain like https://us-east-1.aws.edge.axiom.co; do not include /v1/traces, /v1/logs, or /v1/metrics"
				: null,
	};
}

function collectExecutionControlRuntimeConfigStatus(
	root: string,
	env: Env,
	surface: string,
): Record<string, unknown> {
	if (surface !== "execution-control") {
		return {};
	}
	const rawPath = env.EXECUTION_CONTROL_RUNTIME_CONFIG_PATH?.trim() ?? "";
	if (!rawPath) {
		return {
			required: true,
			present: false,
			ready: false,
			path: null,
			config: null,
			error: "EXECUTION_CONTROL_RUNTIME_CONFIG_PATH is required",
		};
	}
	const path = isAbsolute(rawPath) ? rawPath : join(root, rawPath);
	try {
		const config = JSON.parse(readFileSync(path, "utf8"));
		if (config.schema_version !== "campus_execution_control_runtime_config.v1") {
			return {
				required: true,
				present: true,
				ready: false,
				path,
				config: null,
				error: "runtime config schema_version must be campus_execution_control_runtime_config.v1",
			};
		}
		return { required: true, present: true, ready: true, path, config, error: null };
	} catch (error) {
		return {
			required: true,
			present: true,
			ready: false,
			path,
			config: null,
			error: `runtime config is not readable: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function settingPresent(
	settings: Record<string, Record<string, unknown>>,
	settingName: string,
): boolean {
	return settings[settingName]?.present === true;
}

function postgresDiagnosticsReady(
	postgres: { shared: Record<string, unknown> },
	checkConnectivity: boolean,
): boolean {
	if (!checkConnectivity) {
		return true;
	}
	const connectivity = postgres.shared.connectivity;
	return isRecord(connectivity) && connectivity.ok === true;
}

function collectProviderStatus(
	env: Env,
	surfaceName: string,
	checkedKeys: readonly string[],
): Record<string, unknown> {
	const resolvedKey = checkedKeys.find((key) => env[key]?.trim()) ?? null;
	if (!resolvedKey) {
		return {
			present: false,
			surface_name: surfaceName,
			checked_keys: [...checkedKeys],
			resolved_key: null,
			error: `missing provider api key for surface ${surfaceName}; checked ${checkedKeys.join(" > ")}`,
		};
	}
	return {
		present: true,
		surface_name: surfaceName,
		checked_keys: [...checkedKeys],
		resolved_key: resolvedKey,
		error: null,
	};
}

function collectEnvFileStatus(
	root: string,
	relativePath: string,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[],
): Record<string, unknown> {
	const path = join(root, relativePath);
	const values = existsSync(path) ? parseEnvFile(path) : {};
	const missingKeys = requiredKeys.filter((key) => !values[key]?.trim());
	return {
		path: relativePath,
		file_found: existsSync(path),
		required_keys: [...requiredKeys],
		optional_keys: [...optionalKeys],
		present_required_keys: requiredKeys.filter((key) => values[key]?.trim()),
		present_optional_keys: optionalKeys.filter((key) => values[key]?.trim()),
		missing_keys: missingKeys,
		ready: missingKeys.length === 0,
	};
}

function collectSettingStatus(
	env: Env,
	checkedKeys: readonly string[],
	required: boolean,
): Record<string, unknown> {
	for (const key of checkedKeys) {
		if (env[key]?.trim()) {
			return {
				required,
				present: true,
				checked_keys: [...checkedKeys],
				resolved_key: key,
				error: null,
			};
		}
	}
	return {
		required,
		present: false,
		checked_keys: [...checkedKeys],
		resolved_key: null,
		error: `missing setting; checked ${checkedKeys.join(" > ")}`,
	};
}

function collectObjectStoreCredentialsStatus(env: Env): Record<string, unknown> {
	const sharedKeys = ["OBJECT_STORE_ACCESS_KEY", "OBJECT_STORE_SECRET_KEY"] as const;
	const sourceKeys = ["OBJECT_STORE_SOURCE_ACCESS_KEY", "OBJECT_STORE_SOURCE_SECRET_KEY"] as const;
	const derivedKeys = [
		"OBJECT_STORE_DERIVED_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_SECRET_KEY",
	] as const;
	const checkedKeys = [...sharedKeys, ...sourceKeys, ...derivedKeys];
	if (sharedKeys.every((key) => env[key]?.trim())) {
		return {
			required: true,
			present: true,
			checked_keys: checkedKeys,
			resolved_key: "shared:OBJECT_STORE_ACCESS_KEY+OBJECT_STORE_SECRET_KEY",
			error: null,
		};
	}
	if (sourceKeys.every((key) => env[key]?.trim()) && derivedKeys.every((key) => env[key]?.trim())) {
		return {
			required: true,
			present: true,
			checked_keys: checkedKeys,
			resolved_key:
				"bucket_scoped:OBJECT_STORE_SOURCE_ACCESS_KEY+OBJECT_STORE_SOURCE_SECRET_KEY;OBJECT_STORE_DERIVED_ACCESS_KEY+OBJECT_STORE_DERIVED_SECRET_KEY",
			error: null,
		};
	}
	return {
		required: true,
		present: false,
		checked_keys: checkedKeys,
		resolved_key: null,
		error:
			"missing object-store credentials; ingestion requires either shared OBJECT_STORE_ACCESS_KEY/OBJECT_STORE_SECRET_KEY credentials or both bucket-scoped OBJECT_STORE_SOURCE_* and OBJECT_STORE_DERIVED_* credential pairs",
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
