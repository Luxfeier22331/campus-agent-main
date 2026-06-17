import { TsTaskHandlerRegistry, type TsTaskHandlerResult } from "./task-executor";
import type {
	IngestionArtifactRef,
	IngestionTaskEnvelope,
	IngestionTaskRecord,
	IngestionTaskRegistryTask,
} from "./types";

const DEFAULT_TS_TASK_KINDS: readonly IngestionTaskEnvelope["task_kind"][] = [
	"source_truth_materialize",
	"canonical_document_materialize",
	"structured_projection_publish",
	"operator_projection_snapshot",
	"alias_publish",
];

export function createDefaultTsTaskHandlerRegistry(): TsTaskHandlerRegistry {
	const registry = new TsTaskHandlerRegistry();
	for (const taskKind of DEFAULT_TS_TASK_KINDS) {
		registry.register(taskKind, runContractCloseoutTask);
	}
	return registry;
}

async function runContractCloseoutTask(
	task: IngestionTaskRecord,
	registryTask: IngestionTaskRegistryTask,
): Promise<TsTaskHandlerResult> {
	requireObjectStoreInputRef(task.input_ref);
	requireRegistryContractShape(registryTask);
	return {
		artifactRefs: [
			{
				kind: "inline",
				uri: createDefaultCloseoutArtifactUri(task, registryTask),
			},
		],
	};
}

function createDefaultCloseoutArtifactUri(
	task: IngestionTaskRecord,
	registryTask: IngestionTaskRegistryTask,
): string {
	return (
		`ingestion-control://${task.source_family}/${task.source_channel}/${task.corpus}/${task.collection}` +
		`/runs/${task.run_id}/tasks/${task.task_id}` +
		`/closeout/${closeoutArtifactKindForTaskKind(task.task_kind)}` +
		`/contracts/${registryTask.output_contract}`
	);
}

function closeoutArtifactKindForTaskKind(taskKind: IngestionTaskEnvelope["task_kind"]): string {
	switch (taskKind) {
		case "source_truth_materialize":
			return "source_truth_materialization_closeout";
		case "canonical_document_materialize":
			return "canonical_document_materialization_closeout";
		case "structured_projection_publish":
			return "structured_projection_publish_closeout";
		case "operator_projection_snapshot":
			return "operator_projection_snapshot_closeout";
		case "alias_publish":
			return "alias_publish_closeout";
		default:
			throw new Error(`unsupported default TS task kind: ${taskKind}`);
	}
}

function requireObjectStoreInputRef(inputRef: IngestionArtifactRef): void {
	if (inputRef.kind !== "object_store") {
		throw new Error(`input_ref must be object_store, got ${inputRef.kind}`);
	}
	if (!inputRef.uri.startsWith("s3://")) {
		throw new Error(`input_ref object_store uri must use s3://, got ${inputRef.uri}`);
	}
}

function requireRegistryContractShape(registryTask: IngestionTaskRegistryTask): void {
	if (!registryTask.input_contract.trim()) {
		throw new Error(`input_contract must not be empty for ${registryTask.task_kind}`);
	}
	if (!registryTask.output_contract.trim()) {
		throw new Error(`output_contract must not be empty for ${registryTask.task_kind}`);
	}
}
