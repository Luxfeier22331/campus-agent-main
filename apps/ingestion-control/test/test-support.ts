import type {
	IngestionTaskRecord,
	IngestionTaskRegistry,
	IngestionTaskStore,
} from "../src/index.ts";
import {
	ingestionTaskExecutionErrorCode,
	ingestionTaskExecutionErrorMessage,
	type RustKernelRegistry,
	runDeclaredIngestionTask,
	type TsTaskHandlerRegistry,
} from "../src/task-executor";

export type TestIngestionTaskRunResult =
	| {
			status: "completed";
			task: IngestionTaskRecord;
	  }
	| {
			status: "failed";
			task: IngestionTaskRecord;
	  };

export async function runDeclaredTaskForTest(input: {
	store: IngestionTaskStore;
	registry: IngestionTaskRegistry;
	tsHandlers: TsTaskHandlerRegistry;
	rustKernels: RustKernelRegistry;
	taskId: string;
	workflowRunId?: string;
}): Promise<TestIngestionTaskRunResult> {
	const running = await input.store.markTaskRunning({
		taskId: input.taskId,
		workflowRunId: input.workflowRunId ?? "test-workflow-run",
	});
	try {
		const result = await runDeclaredIngestionTask({
			registry: input.registry,
			rustKernels: input.rustKernels,
			task: running,
			tsHandlers: input.tsHandlers,
		});
		const completed = await input.store.completeTask({
			taskId: input.taskId,
			artifactRefs: result.artifactRefs ?? [],
		});
		return { status: "completed", task: completed };
	} catch (error) {
		const failed = await input.store.failTask({
			taskId: input.taskId,
			errorCode: ingestionTaskExecutionErrorCode(error),
			errorMessage: ingestionTaskExecutionErrorMessage(error),
		});
		return { status: "failed", task: failed };
	}
}
