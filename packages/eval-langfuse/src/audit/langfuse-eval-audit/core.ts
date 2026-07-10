import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { collectEnvDoctorStatus } from "../../../../../scripts/deploy/doctor-env/core.ts";
import {
	activeDocTokenScanPaths,
	activeEvalDocRegressionTokens,
	activeSourceTokenScanPaths,
	appApiEvalIngressContractPath,
	type Check,
	ciInternalSurfaceDetectorPath,
	evalMapPath,
	forbiddenAppApiEvalIngressTokens,
	langfuseCliPath,
	langfuseRuntimeContractPath,
	otelTaxonomyPath,
	ragAssetRoot,
	requiredAppApiEvalMaterializationTokens,
	requiredEvalMapActiveTokens,
	requiredLangfuseCliTokens,
	requiredRagasProjectionTokens,
	requiredRagasScoreNames,
	retiredActiveDocTokens,
	retiredActiveSourceTokenScanExcludePaths,
	retiredActiveSourceTokens,
	retiredEvalPolicyPaths,
	retiredLangfuseCliTokens,
	retiredSourcePaths,
	scoreRegistryPath,
	traceEvidencePath,
} from "./constants.ts";

export function collectLangfuseEvalStatus(root: string): Record<string, unknown> {
	const envDoctor = collectEnvDoctorStatus({ root, surface: "evals", env: { ...process.env } });
	return {
		surface: "langfuse_eval_audit",
		repo_root: root,
		overall_ready: Boolean(envDoctor.overall_ready),
		env_doctor: envDoctor,
	};
}

export function renderLangfuseEvalStatusText(status: Record<string, unknown>): string {
	const envDoctor = isRecord(status.env_doctor) ? status.env_doctor : {};
	return [
		"Langfuse Eval Doctor",
		`repo_root: ${status.repo_root}`,
		`overall_ready: ${status.overall_ready}`,
		`env_doctor_ready: ${envDoctor.overall_ready}`,
	].join("\n");
}

export function auditLangfuseEvalConfiguration(root: string): Record<string, unknown> {
	const checks: Check[] = [
		auditRetiredEvalsPackageAbsent(root),
		auditRetiredSourcePathsAbsent(root),
		auditScoreRegistryOwners(root),
		auditScoreRegistryRequiredScoresPresent(root),
		auditScoreRegistryRetiredScoresAbsent(root),
		auditScoreRegistryReleaseGateFieldsAbsent(root),
		auditLangfuseCliRetiredCommandsAbsent(root),
		auditLangfuseCliRequiredCommandsPresent(root),
		auditRagasProjectionMaterializationPresent(root),
		auditRetiredActiveSourceTokensAbsent(root),
		auditRetiredActiveDocTokensAbsent(root),
		auditActiveEvalDocRegressionTokensAbsent(root),
		auditAppApiEvalIngressIsMaterializationOnly(root),
		auditRetiredEvalPolicyPathsAbsent(root),
		auditRetiredAssetSplitsAbsent(root),
		auditEvalMapRetiredLanesAbsent(root),
		auditLangfuseCiSurfaceContractPath(root),
		auditUniqueLiteralList({
			root,
			relativePath: traceEvidencePath,
			listName: "REQUIRED_OBSERVATION_ATTRIBUTES",
			checkId: "trace_evidence_required_observation_attributes_unique",
		}),
		auditMarkdownBulletTokenUnique({
			root,
			relativePath: otelTaxonomyPath,
			sectionHeading: "### Runtime / Request Attributes",
			token: "selected_tool",
			checkId: "otel_runtime_request_selected_tool_unique",
		}),
	];
	return {
		surface: "langfuse_eval_audit.audit",
		passed: checks.every((check) => check.passed),
		checks,
	};
}

function auditRetiredEvalsPackageAbsent(root: string): Check {
	const retiredPath = join(root, "packages/evals");
	return {
		check_id: "retired_evals_package_absent",
		passed: !existsSync(retiredPath),
		path: retiredPath,
	};
}

function auditRetiredSourcePathsAbsent(root: string): Check {
	const present = retiredSourcePaths.filter((path) => existsSync(join(root, path)));
	return {
		check_id: "retired_source_paths_absent",
		passed: present.length === 0,
		present,
	};
}

function auditScoreRegistryOwners(root: string): Check {
	const registryPath = join(root, scoreRegistryPath);
	if (!existsSync(registryPath)) {
		return {
			check_id: "score_registry_owners",
			passed: false,
			missing_registry: registryPath,
			retired_owners: [],
		};
	}
	const scores = readScores(registryPath);
	const retiredOwners = [
		...new Set(scores.map((score) => score.owner).filter((owner) => owner === "packages/evals")),
	].sort();
	return {
		check_id: "score_registry_owners",
		passed: retiredOwners.length === 0,
		registry: registryPath,
		retired_owners: retiredOwners,
	};
}

function auditScoreRegistryRequiredScoresPresent(root: string): Check {
	const registryPath = join(root, scoreRegistryPath);
	if (!existsSync(registryPath)) {
		return {
			check_id: "score_registry_required_scores_present",
			passed: false,
			missing_registry: registryPath,
			missing: requiredRagasScoreNames,
		};
	}
	const names = new Set(readScores(registryPath).map((score) => String(score.name)));
	const missing = requiredRagasScoreNames.filter((name) => !names.has(name));
	return {
		check_id: "score_registry_required_scores_present",
		passed: missing.length === 0,
		registry: registryPath,
		missing,
	};
}

function auditScoreRegistryRetiredScoresAbsent(root: string): Check {
	const registryPath = join(root, scoreRegistryPath);
	if (!existsSync(registryPath)) {
		return {
			check_id: "score_registry_retired_scores_absent",
			passed: false,
			missing_registry: registryPath,
			retired_scores: [],
		};
	}
	const retiredScores = readScores(registryPath)
		.filter(retiredScore)
		.map((score) => String(score.name))
		.sort();
	return {
		check_id: "score_registry_retired_scores_absent",
		passed: retiredScores.length === 0,
		registry: registryPath,
		retired_scores: retiredScores,
	};
}

function auditScoreRegistryReleaseGateFieldsAbsent(root: string): Check {
	const registryPath = join(root, scoreRegistryPath);
	if (!existsSync(registryPath)) {
		return {
			check_id: "score_registry_release_gate_fields_absent",
			passed: false,
			missing_registry: registryPath,
			scores: [],
		};
	}
	const scores = readScores(registryPath)
		.filter((score) => Object.hasOwn(score, "release_gate"))
		.map((score) => String(score.name))
		.sort();
	return {
		check_id: "score_registry_release_gate_fields_absent",
		passed: scores.length === 0,
		registry: registryPath,
		scores,
	};
}

function auditLangfuseCliRetiredCommandsAbsent(root: string): Check {
	return tokenPresenceCheck({
		root,
		path: langfuseCliPath,
		tokens: retiredLangfuseCliTokens,
		checkId: "langfuse_cli_retired_commands_absent",
		expectPresent: false,
		missingKey: "missing_cli",
	});
}

function auditLangfuseCliRequiredCommandsPresent(root: string): Check {
	return tokenPresenceCheck({
		root,
		path: langfuseCliPath,
		tokens: requiredLangfuseCliTokens,
		checkId: "langfuse_cli_required_commands_present",
		expectPresent: true,
		missingKey: "missing_cli",
	});
}

function auditRagasProjectionMaterializationPresent(root: string): Check {
	return tokenPresenceCheck({
		root,
		path: "packages/eval-langfuse/src/ragas-langfuse.ts",
		tokens: requiredRagasProjectionTokens,
		checkId: "ragas_projection_materialization_present",
		expectPresent: true,
		missingKey: "missing_path",
	});
}

function auditRetiredActiveSourceTokensAbsent(root: string): Check {
	const present = scanTokens({
		root,
		roots: activeSourceTokenScanPaths,
		excludePaths: retiredActiveSourceTokenScanExcludePaths,
		suffixes: new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]),
		tokens: retiredActiveSourceTokens,
	});
	return {
		check_id: "retired_active_source_tokens_absent",
		passed: present.length === 0,
		present,
	};
}

function auditRetiredActiveDocTokensAbsent(root: string): Check {
	const present = scanTokens({
		root,
		roots: activeDocTokenScanPaths,
		suffixes: new Set([".md", ".json"]),
		tokens: retiredActiveDocTokens,
	});
	return {
		check_id: "retired_active_doc_tokens_absent",
		passed: present.length === 0,
		present,
	};
}

function auditActiveEvalDocRegressionTokensAbsent(root: string): Check {
	const present = scanTokens({
		root,
		roots: activeDocTokenScanPaths,
		suffixes: new Set([".md", ".json"]),
		tokens: activeEvalDocRegressionTokens,
	});
	return {
		check_id: "active_eval_doc_regression_tokens_absent",
		passed: present.length === 0,
		present,
	};
}

function auditAppApiEvalIngressIsMaterializationOnly(root: string): Check {
	const path = join(root, appApiEvalIngressContractPath);
	if (!existsSync(path)) {
		return {
			check_id: "app_api_eval_ingress_is_materialization_only",
			passed: false,
			missing_path: path,
			missing: requiredAppApiEvalMaterializationTokens,
			forbidden: [],
		};
	}
	const text = readFileSync(path, "utf8");
	const missing = requiredAppApiEvalMaterializationTokens.filter((token) => !text.includes(token));
	const forbidden = forbiddenAppApiEvalIngressTokens.filter((token) => text.includes(token));
	return {
		check_id: "app_api_eval_ingress_is_materialization_only",
		passed: missing.length === 0 && forbidden.length === 0,
		missing,
		forbidden,
	};
}

function auditRetiredEvalPolicyPathsAbsent(root: string): Check {
	const present = retiredEvalPolicyPaths.filter((path) => existsSync(join(root, path)));
	return {
		check_id: "retired_eval_policy_paths_absent",
		passed: present.length === 0,
		present,
	};
}

function auditRetiredAssetSplitsAbsent(root: string): Check {
	const present: { path: string; token: string }[] = [];
	const assetRoot = join(root, ragAssetRoot);
	if (existsSync(assetRoot)) {
		for (const path of walkFiles(assetRoot)) {
			if (!path.endsWith(".json")) {
				continue;
			}
			const text = readFileSync(path, "utf8");
			for (const token of ['"split": "release_gate"', '"split": "regression_locked"']) {
				if (text.includes(token)) {
					present.push({ path: relativePath(root, path), token });
				}
			}
		}
	}
	return {
		check_id: "retired_asset_splits_absent",
		passed: present.length === 0,
		present,
	};
}

function auditEvalMapRetiredLanesAbsent(root: string): Check {
	const path = join(root, evalMapPath);
	if (!existsSync(path)) {
		return {
			check_id: "eval_map_retired_lanes_absent",
			passed: false,
			missing_eval_map: path,
			present: [],
		};
	}
	const text = readFileSync(path, "utf8");
	const missing = requiredEvalMapActiveTokens.filter((token) => !text.includes(token));
	return {
		check_id: "eval_map_active_lanes_are_ragas_only",
		passed: missing.length === 0,
		missing,
	};
}

function auditLangfuseCiSurfaceContractPath(root: string): Check {
	const detectorPath = join(root, ciInternalSurfaceDetectorPath);
	const retiredPath = "docs/contracts/langfuse-runtime-observability-contract.md";
	if (!existsSync(detectorPath)) {
		return {
			check_id: "langfuse_ci_surface_contract_path",
			passed: false,
			missing_detector: detectorPath,
		};
	}
	const text = readFileSync(detectorPath, "utf8");
	return {
		check_id: "langfuse_ci_surface_contract_path",
		passed: text.includes(langfuseRuntimeContractPath) && !text.includes(retiredPath),
		active_path_present: text.includes(langfuseRuntimeContractPath),
		retired_path_present: text.includes(retiredPath),
	};
}

function auditUniqueLiteralList(input: {
	checkId: string;
	listName: string;
	relativePath: string;
	root: string;
}): Check {
	const path = join(input.root, input.relativePath);
	if (!existsSync(path)) {
		return { check_id: input.checkId, passed: false, missing_path: path, duplicates: [] };
	}
	const text = readFileSync(path, "utf8");
	const match = text.match(
		new RegExp(`${escapeRegExp(input.listName)}\\s*=\\s*\\[(?<body>[\\s\\S]*?)\\];`),
	);
	if (!match?.groups?.body) {
		return { check_id: input.checkId, passed: false, missing_list: input.listName, duplicates: [] };
	}
	const values = [...match.groups.body.matchAll(/"([^"]+)"/g)].map((entry) => entry[1] ?? "");
	const duplicatedValues = duplicates(values);
	return {
		check_id: input.checkId,
		passed: duplicatedValues.length === 0,
		duplicates: duplicatedValues,
	};
}

function auditMarkdownBulletTokenUnique(input: {
	checkId: string;
	relativePath: string;
	root: string;
	sectionHeading: string;
	token: string;
}): Check {
	const path = join(input.root, input.relativePath);
	if (!existsSync(path)) {
		return { check_id: input.checkId, passed: false, missing_path: path, count: 0 };
	}
	const body = markdownSectionBody(readFileSync(path, "utf8"), input.sectionHeading);
	const count = [...body.matchAll(new RegExp(`^- \`${escapeRegExp(input.token)}\`$`, "gm"))].length;
	return {
		check_id: input.checkId,
		passed: count === 1,
		count,
	};
}

function tokenPresenceCheck(input: {
	checkId: string;
	expectPresent: boolean;
	missingKey: string;
	path: string;
	root: string;
	tokens: string[];
}): Check {
	const path = join(input.root, input.path);
	if (!existsSync(path)) {
		return {
			check_id: input.checkId,
			passed: false,
			[input.missingKey]: path,
			[input.expectPresent ? "missing" : "present"]: input.expectPresent ? input.tokens : [],
		};
	}
	const text = readFileSync(path, "utf8");
	const values = input.tokens.filter((token) =>
		input.expectPresent ? !text.includes(token) : text.includes(token),
	);
	return {
		check_id: input.checkId,
		passed: values.length === 0,
		[input.expectPresent ? "missing" : "present"]: values,
	};
}

function readScores(registryPath: string): Record<string, unknown>[] {
	const payload = readJson(registryPath);
	return Array.isArray(payload.scores) ? payload.scores.filter(isRecord) : [];
}

function retiredScore(score: Record<string, unknown>): boolean {
	const name = String(score.name ?? "");
	const evalKinds = Array.isArray(score.eval_kinds) ? score.eval_kinds.map(String) : [];
	return (
		name.startsWith("retrieval.") ||
		name.startsWith("context.") ||
		evalKinds.includes("agent_eval") ||
		evalKinds.includes("context_followup")
	);
}

function readJson(path: string): Record<string, unknown> {
	const payload = JSON.parse(readFileSync(path, "utf8"));
	if (!isRecord(payload)) {
		throw new Error(`${path}: expected JSON object`);
	}
	return payload;
}

function scanTokens(input: {
	excludePaths?: string[];
	root: string;
	roots: string[];
	suffixes: Set<string>;
	tokens: string[];
}): { path: string; token: string }[] {
	const present: { path: string; token: string }[] = [];
	for (const relativeRoot of input.roots) {
		const absoluteRoot = join(input.root, relativeRoot);
		if (!existsSync(absoluteRoot)) {
			continue;
		}
		for (const path of walkFiles(absoluteRoot)) {
			const relativeFilePath = relativePath(input.root, path);
			if (input.excludePaths?.includes(relativeFilePath)) {
				continue;
			}
			if (!input.suffixes.has(path.slice(path.lastIndexOf(".")))) {
				continue;
			}
			const text = readFileSync(path, "utf8");
			for (const token of input.tokens) {
				if (text.includes(token)) {
					present.push({ path: relativeFilePath, token });
				}
			}
		}
	}
	return present;
}

function walkFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	const result: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			result.push(...walkFiles(path));
		}
		if (entry.isFile()) {
			result.push(path);
		}
	}
	return result.sort();
}

function markdownSectionBody(text: string, heading: string): string {
	const lines = text.split(/\r?\n/);
	const headingIndex = lines.indexOf(heading);
	if (headingIndex < 0) {
		return "";
	}
	const body: string[] = [];
	for (const line of lines.slice(headingIndex + 1)) {
		if (line.startsWith("## ") || line.startsWith("### ")) {
			break;
		}
		body.push(line);
	}
	return body.join("\n");
}

function duplicates(values: string[]): string[] {
	const seen = new Set<string>();
	const duplicateValues = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			duplicateValues.add(value);
		}
		seen.add(value);
	}
	return [...duplicateValues].sort();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relativePath(root: string, path: string): string {
	return path.slice(root.length + 1).replaceAll("\\", "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
