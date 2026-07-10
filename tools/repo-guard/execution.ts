import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseToml } from "smol-toml";
import { issue, type RepoGuardIssue } from "./common.ts";

const activeRuntimePrefixes = [
	"/.dockerignore",
	"/.env.example",
	"/.github/",
	"/apps/",
	"/configs/",
	"/docs/",
	"/env/",
	"/infra/",
	"/packages/",
	"/scripts/",
];
const executionRuntimeAdminQdrantAllowed = [
	"/docs/architecture/system/data-plane.md",
	"/docs/environment/providers.md",
	"/docs/runbooks/gitops-k8s.md",
	"/infra/gitops/secrets/README.md",
];
const retiredPythonSurfaceAllowed = [
	"/apps/execution-control/internal/config/retired_settings.go",
	"/apps/execution-control/internal/config/config.go",
	"/apps/execution-control/internal/config/config_test.go",
	"/configs/runtime/env-surface-policy.v1.json",
];
const onlinePythonBridgeForbidden = [
	'env:"SUPERVISOR_AGENT_WORKER_',
	'env:"EXECUTION_CONTROL_BRIDGE_',
	'resolved.set("SUPERVISOR_AGENT_WORKER_',
	"export SUPERVISOR_AGENT_WORKER_",
	"SUPERVISOR_AGENT_WORKER_SHARED_SECRET is missing",
	"supervisor-agent-worker:27052",
	"execution_control_staging_bridge_shared_secret",
	"exec -T supervisor-agent-worker",
	"logs --no-color supervisor-agent-worker",
	"bridge_runtime",
];
const onlinePythonBridgePaths = [
	"/apps/execution-control/cmd/",
	"/apps/execution-control/internal/config/",
	"/apps/execution-control/internal/httpapi/server.go",
	"/infra/local/docker-compose.execution-runtime.yml",
];
const temporalRagGraphForbidden = ['"semantic.rag"', "InvokeSemanticWorker", "FinalizeChatAnswer"];
const temporalRagGraphPaths = [
	"/apps/execution-control/internal/temporalruntime/",
	"/apps/execution-control/internal/httpapi/temporal_activity.go",
	"/apps/execution-control/internal/httpapi/temporal_activity_projection.go",
	"/apps/execution-control/internal/httpapi/temporal_memory_projection.go",
	"/apps/execution-control/internal/httpapi/temporal_rag_projection.go",
	"/apps/execution-control/internal/httpapi/personal_memory_recall.go",
	"/apps/execution-control/internal/httpapi/rag_synthesis.go",
];
const oldCancelRouteForbidden = [
	'path == "/internal/execution/cancel"',
	"handleCancel(writer, request)",
	"propagateBridgeCancel",
];
const oldCancelRoutePaths = [
	"/apps/execution-control/internal/httpapi/server.go",
	"/apps/execution-control/internal/httpapi/cancel_handler.go",
];
const deterministicAgentFieldForbidden = [
	"owner_agent",
	"AgentSpec",
	"allowed_agents",
	"agent_id",
	"selected_target",
	"selected target",
	"selected_target_label",
	"agent_spec_admission_failed",
];
const deterministicAgentFieldAllowed = ["/apps/app-api/drizzle/"];
const retiredWorkerPath = "apps/supervisor-agent-worker";
const retiredTestPath = "tests/supervisor";
const retiredEnvPrefix = "SUPERVISOR_";
const retiredPackageNames = [
	"campus_supervisor_agent_worker",
	"campus-supervisor-agent-worker",
	"campus-supervisor-agent-worker-dev",
];
const activeToolConceptForbidden = [
	'"selectedTool": "knowledge"',
	'"requestedTool": "knowledge"',
	'intentTool: "knowledge"',
	'"intentTool": "knowledge"',
	'"selectedTool": "campus_services"',
	'"requestedTool": "campus_services"',
	'intentTool: "campus_services"',
	'"intentTool": "campus_services"',
	'Tool: "primary_agent"',
	'tool: "primary_agent"',
	'"tool": "primary_agent"',
	"structured_query",
	"structured-query",
	"structured runtime",
	"structured_runtime",
	"structuredquery",
	"EXECUTION_CONTROL_STRUCTURED_QUERY",
	"tool_family",
	"toolFamily",
	"ToolFamily",
	"worker_role",
	"workerRole",
	"WorkerRole",
	"`supervisor` concept is an abstract",
];
const textSuffixes = new Set([
	".example",
	".go",
	".json",
	".md",
	".mjs",
	".ps1",
	".py",
	".sh",
	".toml",
	".ts",
	".tsx",
	".yaml",
	".yml",
]);

export function auditExecutionGuard(root: string): RepoGuardIssue[] {
	const files = trackedTextFiles(root);
	return [
		...auditRetiredPythonWorker(root, files),
		...containsIssues(files, "execution runtime inventory must not consume Qdrant admin keys", {
			allowed: executionRuntimeAdminQdrantAllowed,
			needles: ["QDRANT_API_KEY", "QDRANT_READ_ONLY_API_KEY"],
			pathFilter: (path) =>
				path.startsWith("/infra/k8s/execution-runtime/") ||
				path.startsWith("/env/commands/execution-control-runtime") ||
				path.startsWith("/configs/runtime/k8s-execution-runtime"),
		}),
		...containsIssues(files, "online lifecycle must not require Python bridge", {
			needles: onlinePythonBridgeForbidden,
			pathFilter: (path) => startsWithAny(path, onlinePythonBridgePaths),
		}),
		...containsIssues(files, "Temporal RAG graph must not use retired semantic activity", {
			needles: temporalRagGraphForbidden,
			pathFilter: (path) => startsWithAny(path, temporalRagGraphPaths),
		}),
		...containsIssues(files, "old cancel route must not be serving path", {
			needles: oldCancelRouteForbidden,
			pathFilter: (path) => startsWithAny(path, oldCancelRoutePaths),
		}),
		...auditLocalRuntimeCompose(root),
		...containsIssues(files, "active contracts must use tool fields, not agent fields", {
			allowed: deterministicAgentFieldAllowed,
			needles: deterministicAgentFieldForbidden,
			pathFilter: (path) =>
				path.startsWith("/configs/runtime/") ||
				path.startsWith("/packages/contracts/") ||
				path.startsWith("/apps/app-api/src/modules/integration/generated/"),
			tokenBoundary: true,
		}),
	].sort((left, right) =>
		`${left.path}\0${left.message}`.localeCompare(`${right.path}\0${right.message}`),
	);
}

function auditRetiredPythonWorker(root: string, files: TrackedTextFile[]): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const pyproject = parseToml(readFileSync(join(root, "pyproject.toml"), "utf8")) as Record<
		string,
		unknown
	>;
	const members = workspaceMembers(pyproject);
	if (members.has(retiredWorkerPath)) {
		issues.push(issue("pyproject.toml", "retired Python worker must not be a uv workspace member"));
	}
	for (const path of [retiredWorkerPath, retiredTestPath]) {
		if (existsSync(join(root, path))) {
			issues.push(issue(path, "retired Python worker/test path must not exist"));
		}
	}
	issues.push(
		...containsIssues(files, "retired Python worker package must not be imported or executed", {
			allowed: retiredPythonSurfaceAllowed,
			needles: retiredPackageNames,
			pathFilter: activeTextPath,
		}),
		...containsIssues(files, "active runtime must not reference retired Python bridge", {
			allowed: retiredPythonSurfaceAllowed,
			needles: [
				"/internal/bridge/supervisor/answer",
				`${retiredEnvPrefix}AGENTS_SDK_RUNTIME_ENABLED`,
				`${retiredEnvPrefix}AGENT_WORKER_`,
				`${retiredEnvPrefix}PROMPT_MODEL`,
				"supervisor_runtime_process_smoke",
			],
			pathFilter: activeTextPath,
		}),
		...containsIssues(files, "active truth must expose concrete tools", {
			allowed: retiredPythonSurfaceAllowed,
			needles: activeToolConceptForbidden,
			pathFilter: (path) =>
				path.startsWith("/configs/runtime/") ||
				path.startsWith("/packages/contracts/") ||
				path.startsWith("/apps/app-api/src/modules/integration/generated/"),
		}),
	);
	return issues;
}

function auditLocalRuntimeCompose(root: string): RepoGuardIssue[] {
	const path = "infra/local/docker-compose.execution-runtime.yml";
	const text = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "";
	const issues: RepoGuardIssue[] = [];
	for (const service of ["agent-runtime:", "activity-worker-agent:"]) {
		if (!text.includes(service)) {
			issues.push(issue(path, `local runtime compose must include ${service}`));
		}
	}
	return issues;
}

interface TrackedTextFile {
	path: string;
	text: string;
}

function containsIssues(
	files: TrackedTextFile[],
	message: string,
	input: {
		allowed?: string[];
		needles: string[];
		pathFilter: (path: string) => boolean;
		tokenBoundary?: boolean;
	},
): RepoGuardIssue[] {
	const allowed = input.allowed ?? [];
	const issues: RepoGuardIssue[] = [];
	for (const file of files) {
		if (
			file.path === "/tools/repo-guard/execution.ts" ||
			!input.pathFilter(file.path) ||
			allowed.some((part) => file.path.includes(part))
		) {
			continue;
		}
		for (const needle of input.needles) {
			const matched = input.tokenBoundary
				? new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(needle)}(?![A-Za-z0-9_])`, "u").test(
						file.text,
					)
				: file.text.includes(needle);
			if (matched) {
				issues.push(issue(file.path.slice(1), `${message}: ${needle}`));
			}
		}
	}
	return issues;
}

function trackedTextFiles(root: string): TrackedTextFile[] {
	return walkFiles(root)
		.filter((path) => textSuffixes.has(suffix(path)))
		.map((path) => ({
			path: `/${relative(root, path).replaceAll("\\", "/")}`,
			text: readFileSync(path, "utf8"),
		}));
}

function walkFiles(root: string): string[] {
	const result: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if ([".git", "node_modules", ".tmp", ".worktrees"].includes(entry.name)) {
			continue;
		}
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			result.push(...walkFiles(path));
		} else if (entry.isFile()) {
			result.push(path);
		}
	}
	return result;
}

function workspaceMembers(pyproject: Record<string, unknown>): Set<string> {
	const tool = recordValue(pyproject.tool);
	const uv = recordValue(tool?.uv);
	const workspace = recordValue(uv?.workspace);
	const members = Array.isArray(workspace?.members) ? workspace.members : [];
	return new Set(members.filter((member): member is string => typeof member === "string"));
}

function activeTextPath(path: string): boolean {
	return startsWithAny(path, [
		...activeRuntimePrefixes,
		"/tests/",
		"/AGENTS.md",
		"/README.md",
		"/.env.example",
	]);
}

function startsWithAny(path: string, prefixes: string[]): boolean {
	return prefixes.some((prefix) => path.startsWith(prefix));
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function suffix(path: string): string {
	const index = path.lastIndexOf(".");
	return index === -1 ? "" : path.slice(index);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
