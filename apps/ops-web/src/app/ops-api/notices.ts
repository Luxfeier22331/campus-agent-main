import {
	type NoticeAutomationInput,
	NoticeAutomationSchema,
} from "../../shared/notice-automation-contract";
import {
	type NoticeCategoryUpdate,
	NoticeCategoryUpdateSchema,
	NoticeDetailResponseSchema,
	type NoticeJobCreate,
	NoticeJobCreateSchema,
	NoticeJobListResponseSchema,
	NoticeJobResponseSchema,
	NoticeListResponseSchema,
	type NoticeState,
} from "../../shared/ops-contract";
import { fetchJson } from "./core";

export async function fetchNoticeAutomation(options: { signal?: AbortSignal } = {}) {
	return NoticeAutomationSchema.parse(await fetchJson("/api/ops/notices/automation", options));
}
export async function saveNoticeAutomation(input: NoticeAutomationInput) {
	return NoticeAutomationSchema.parse(
		await fetchJson("/api/ops/notices/automation", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		}),
	);
}

export async function fetchNoticeJobs(options: { signal?: AbortSignal } = {}) {
	return NoticeJobListResponseSchema.parse(await fetchJson("/api/ops/notices/jobs", options));
}

export async function createNoticeJob(input: NoticeJobCreate) {
	const body = NoticeJobCreateSchema.parse(input);
	return NoticeJobResponseSchema.parse(
		await fetchJson("/api/ops/notices/jobs", {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}

export async function fetchNotices(input: {
	category?: string;
	page: number;
	q?: string;
	signal?: AbortSignal;
	state?: NoticeState;
}) {
	const params = new URLSearchParams({ page: String(input.page) });
	if (input.category) {
		params.set("category", input.category);
	}
	if (input.q) {
		params.set("q", input.q);
	}
	if (input.state) {
		params.set("state", input.state);
	}
	return NoticeListResponseSchema.parse(
		await fetchJson(`/api/ops/notices?${params.toString()}`, { signal: input.signal }),
	);
}

export async function fetchNotice(noticeId: number, options: { signal?: AbortSignal } = {}) {
	return NoticeDetailResponseSchema.parse(await fetchJson(`/api/ops/notices/${noticeId}`, options));
}

export async function updateNoticeCategory(input: {
	category: NoticeCategoryUpdate["category"];
	noticeId: number;
}) {
	const body = NoticeCategoryUpdateSchema.parse({ category: input.category });
	return NoticeDetailResponseSchema.parse(
		await fetchJson(`/api/ops/notices/${input.noticeId}/category`, {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}
