import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface IngestionTaskExecutabilityIssue {
	path: string;
	task: string;
	message: string;
}

export interface IngestionTaskExecutabilityClassification {
	path: string;
	identity: string;
	executorKind: string;
	status: string;
}

interface RepositoryStructureIssue {
	path: string;
	message: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const executableTsTasks = new Set([
	"authenticated_notice/campus_notices/internal_notice/source_truth_materialize",
	"authenticated_notice/authenticated_documents/file_release_source/source_truth_materialize",
	"official_web/official_web/fresh_news/source_truth_materialize",
	"official_web/official_web/stable_reference/source_truth_materialize",
	"wechat_public_notice/campus_notices/wechat_public_notice/source_truth_materialize",
]);

const executableRustKernels = new Set([
	"chunk-document-units",
	"validate-document-units",
	"validate-release-manifest",
]);

const configOnlyIngestionCollectionDirs = new Set([
	"configs/ingestion/campus_services/transport_schedule",
	"configs/ingestion/curriculum/course_facts",
	"configs/ingestion/curriculum/program_family_facts",
	"configs/ingestion/curriculum/program_semester_facts",
]);

const referenceDataRuntimeProfileNames = new Set([
	"chunk-profile.json",
	"serving-config.json",
	"task-registry.v2.json",
]);

export function classifyIngestionTaskExecutability(
	root = repoRoot,
): IngestionTaskExecutabilityClassification[] {
	const classifications: IngestionTaskExecutabilityClassification[] = [];
	for (const registryPath of registryPaths(root)) {
		const registry = loadJsonObject(registryPath);
		const sourceFamily = stringValue(registry.source_family);
		const corpus = stringValue(registry.corpus);
		const collection = stringValue(registry.collection);
		if (!Array.isArray(registry.tasks)) {
			continue;
		}
		for (const task of registry.tasks) {
			if (!isRecord(task)) {
				continue;
			}
			const registryTaskId = stringValue(task.registry_task_id);
			const executorKind = stringValue(task.executor_kind);
			const kernelId = stringOrUndefined(task.kernel_id);
			const identity = taskIdentity({ sourceFamily, corpus, collection, registryTaskId });
			classifications.push({
				path: relativePosix(root, registryPath),
				identity: classificationIdentity({ identity, executorKind, kernelId }),
				executorKind,
				status: taskStatus({ identity, executorKind, kernelId }),
			});
		}
	}
	return classifications;
}

export function auditIngestionTaskExecutability(
	root = repoRoot,
): IngestionTaskExecutabilityIssue[] {
	const issues: IngestionTaskExecutabilityIssue[] = [];
	for (const registryPath of registryPaths(root)) {
		const registry = loadJsonObject(registryPath);
		const sourceFamily = stringValue(registry.source_family);
		const corpus = stringValue(registry.corpus);
		const collection = stringValue(registry.collection);
		const path = relativePosix(root, registryPath);
		if (!Array.isArray(registry.tasks)) {
			issues.push({
				path,
				task: taskIdentity({ sourceFamily, corpus, collection, registryTaskId: "<registry>" }),
				message: "ingestion task registry tasks must be a list",
			});
			continue;
		}
		for (const task of registry.tasks) {
			if (!isRecord(task)) {
				continue;
			}
			const registryTaskId = stringValue(task.registry_task_id);
			const executorKind = stringValue(task.executor_kind);
			const kernelId = stringOrUndefined(task.kernel_id);
			const identity = taskIdentity({ sourceFamily, corpus, collection, registryTaskId });
			const issue = auditTask({ identity, executorKind, kernelId, path });
			if (issue) {
				issues.push(issue);
			}
		}
	}
	return issues;
}

export function auditIngestionRepositoryStructure(root = repoRoot): RepositoryStructureIssue[] {
	const issues: RepositoryStructureIssue[] = [];
	for (const collectionPath of configOnlyIngestionCollectionDirs) {
		const registryPath = join(root, collectionPath, "task-registry.v2.json");
		if (existsSync(registryPath)) {
			issues.push({
				path: relativePosix(root, registryPath),
				message: "config-only ingestion collection must not declare an executable task registry",
			});
		}
	}
	const referenceRoot = join(root, "configs", "reference-data");
	if (existsSync(referenceRoot)) {
		for (const path of walkFiles(referenceRoot)) {
			const fileName = path.slice(path.lastIndexOf("/") + 1);
			if (referenceDataRuntimeProfileNames.has(fileName)) {
				issues.push({
					path: relativePosix(root, path),
					message: "reference-data must not declare ingestion runtime profiles",
				});
			}
		}
	}
	return issues.sort(compareRepositoryStructureIssues);
}

function auditTask({
	identity,
	executorKind,
	kernelId,
	path,
}: {
	identity: string;
	executorKind: string;
	kernelId: string | undefined;
	path: string;
}): IngestionTaskExecutabilityIssue | undefined {
	if (executorKind === "ts_control") {
		if (executableTsTasks.has(identity)) {
			return;
		}
		return {
			path,
			task: identity,
			message: "registry-declared ts_control task has no default handler",
		};
	}
	if (executorKind === "rust_kernel") {
		if (!kernelId) {
			return {
				path,
				task: identity,
				message: "registry-declared rust_kernel task is missing kernel_id",
			};
		}
		if (executableRustKernels.has(kernelId)) {
			return;
		}
		return {
			path,
			task: `rust_kernel:${kernelId}`,
			message: "registry-declared rust_kernel task has no default kernel bridge",
		};
	}
	return {
		path,
		task: identity,
		message: `unsupported ingestion task executor_kind: ${executorKind}`,
	};
}

function taskStatus({
	identity,
	executorKind,
	kernelId,
}: {
	identity: string;
	executorKind: string;
	kernelId: string | undefined;
}): string {
	if (executorKind === "ts_control") {
		return executableTsTasks.has(identity) ? "executable" : "invalid_registry";
	}
	if (executorKind === "rust_kernel") {
		return kernelId && executableRustKernels.has(kernelId) ? "executable" : "invalid_registry";
	}
	return "invalid_registry";
}

function classificationIdentity({
	identity,
	executorKind,
	kernelId,
}: {
	identity: string;
	executorKind: string;
	kernelId: string | undefined;
}): string {
	if (executorKind === "rust_kernel" && kernelId) {
		return `rust_kernel:${kernelId}`;
	}
	return identity;
}

function taskIdentity({
	sourceFamily,
	corpus,
	collection,
	registryTaskId,
}: {
	sourceFamily: string;
	corpus: string;
	collection: string;
	registryTaskId: string;
}): string {
	return `${sourceFamily}/${corpus}/${collection}/${registryTaskId}`;
}

function registryPaths(root: string): string[] {
	const configRoot = join(root, "configs", "ingestion");
	if (!existsSync(configRoot)) {
		return [];
	}
	const paths: string[] = [];
	collectRegistryPaths(configRoot, paths);
	return paths.sort();
}

function collectRegistryPaths(root: string, paths: string[]): void {
	try {
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			const path = join(root, entry.name);
			if (entry.isDirectory()) {
				collectRegistryPaths(path, paths);
				continue;
			}
			if (entry.isFile() && entry.name === "task-registry.v2.json") {
				paths.push(path);
			}
		}
	} catch {
		return;
	}
}

function walkFiles(root: string): string[] {
	const paths: string[] = [];
	collectFiles(root, paths);
	return paths.sort();
}

function collectFiles(root: string, paths: string[]): void {
	try {
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			const path = join(root, entry.name);
			if (entry.isDirectory()) {
				collectFiles(path, paths);
				continue;
			}
			if (entry.isFile()) {
				paths.push(path);
			}
		}
	} catch {
		return;
	}
}

function loadJsonObject(path: string): Record<string, unknown> {
	const payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!isRecord(payload)) {
		throw new Error(`expected object in ${path}`);
	}
	return payload;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "ingestion-task-executability-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeRegistry(path: string, payload: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(payload), "utf8");
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function compareRepositoryStructureIssues(
	left: RepositoryStructureIssue,
	right: RepositoryStructureIssue,
): number {
	return `${left.path}\0${left.message}`.localeCompare(`${right.path}\0${right.message}`);
}

function runSelfTest(): number {
	expectEqualJson(auditIngestionTaskExecutability(repoRoot), [], "current registry tasks");
	expectEqualJson(auditIngestionRepositoryStructure(repoRoot), [], "current ingestion structure");
	const statuses = new Set(classifyIngestionTaskExecutability(repoRoot).map((item) => item.status));
	expectEqualJson([...statuses], ["executable"], "current registry task status");
	withFixture((root) => {
		writeRegistry(join(root, "configs/ingestion/custom/new_collection/task-registry.v2.json"), {
			schema_version: "ingestion_task_registry.v2",
			source_family: "custom_family",
			corpus: "custom",
			collection: "new_collection",
			tasks: [
				{
					registry_task_id: "source_truth_materialize",
					task_kind: "source_truth_materialize",
					executor_kind: "ts_control",
					input_contract: "custom_source_truth.v1",
					output_contract: "custom_operator_projection.v1",
					can_publish_alias: false,
				},
			],
		});
		expectEqualJson(
			auditIngestionTaskExecutability(root),
			[
				{
					path: "configs/ingestion/custom/new_collection/task-registry.v2.json",
					task: "custom_family/custom/new_collection/source_truth_materialize",
					message: "registry-declared ts_control task has no default handler",
				},
			],
			"missing TS handler rejection",
		);
	});
	withFixture((root) => {
		writeRegistry(join(root, "configs/ingestion/custom/new_collection/task-registry.v2.json"), {
			schema_version: "ingestion_task_registry.v2",
			source_family: "custom_family",
			corpus: "custom",
			collection: "new_collection",
			tasks: [
				{
					registry_task_id: "document_units_validate",
					task_kind: "document_units_validate",
					executor_kind: "rust_kernel",
					input_contract: "canonical_document_units.v1",
					output_contract: "document_units_validation_report.v1",
					can_publish_alias: false,
				},
			],
		});
		expectEqualJson(
			auditIngestionTaskExecutability(root),
			[
				{
					path: "configs/ingestion/custom/new_collection/task-registry.v2.json",
					task: "custom_family/custom/new_collection/document_units_validate",
					message: "registry-declared rust_kernel task is missing kernel_id",
				},
			],
			"missing kernel id rejection",
		);
	});
	withFixture((root) => {
		writeRegistry(
			join(root, "configs/ingestion/campus_services/transport_schedule/task-registry.v2.json"),
			{},
		);
		writeRegistry(join(root, "configs/reference-data/calendar/task-registry.v2.json"), {});
		expectEqualJson(
			auditIngestionRepositoryStructure(root),
			[
				{
					path: "configs/ingestion/campus_services/transport_schedule/task-registry.v2.json",
					message: "config-only ingestion collection must not declare an executable task registry",
				},
				{
					path: "configs/reference-data/calendar/task-registry.v2.json",
					message: "reference-data must not declare ingestion runtime profiles",
				},
			],
			"repository structure rejection",
		);
	});
	console.log("check_ingestion_task_executability self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const issues = auditIngestionTaskExecutability();
	const structureIssues = auditIngestionRepositoryStructure();
	if (structureIssues.length > 0) {
		console.error("Ingestion repository structure check failed:");
		for (const issue of structureIssues) {
			console.error(`- ${issue.path}: ${issue.message}`);
		}
		return 1;
	}
	if (issues.length > 0) {
		console.error("Ingestion task executability check failed:");
		for (const issue of issues) {
			console.error(`- ${issue.path}: ${issue.task}: ${issue.message}`);
		}
		return 1;
	}
	console.log("Validated ingestion task executability.");
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
