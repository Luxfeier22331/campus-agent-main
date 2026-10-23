import type { OcrTask } from "@campus-agent/document-ocr";
import type { OcrResource } from "../shared/ocr-contract.ts";

export function projectOcrResource(
	resource: Omit<OcrResource, "selectedResultId" | "batches">,
	tasks: OcrTask[],
): OcrResource {
	const batches = tasks
		.filter((task) => task.input.kind === "source" && task.input.key === resource.sourceKey)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
	return {
		...resource,
		selectedResultId:
			batches.find((task) => task.status === "completed" && task.result)?.id ?? null,
		batches: batches.map((task) => ({
			id: task.id,
			status: task.status,
			createdAt: task.createdAt,
			pageCount: task.pageCount,
			missingImageCount: task.result?.missingImages.length ?? 0,
			error: task.error,
			hasResult: task.status === "completed" && task.result !== null,
			canResume:
				task.status !== "completed" && (task.status !== "failed" || Boolean(task.providerJobId)),
		})),
	};
}
