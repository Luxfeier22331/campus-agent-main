import {
	type NoticePipelineJobCreate,
	NoticePipelineJobCreateSchema,
	NoticePipelineJobListResponseSchema,
	NoticePipelineJobResponseSchema,
} from "../../shared/ops-contract";
import { fetchJson } from "./core";

export async function fetchNoticePipelineJobs(options: { signal?: AbortSignal } = {}) {
	return NoticePipelineJobListResponseSchema.parse(
		await fetchJson("/api/ops/notice-pipeline/jobs", options),
	);
}

export async function createNoticePipelineJob(input: NoticePipelineJobCreate) {
	const body = NoticePipelineJobCreateSchema.parse(input);
	return NoticePipelineJobResponseSchema.parse(
		await fetchJson("/api/ops/notice-pipeline/jobs", {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}
