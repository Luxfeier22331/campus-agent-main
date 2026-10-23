import {
	DiningMySubmissionPageSchema,
	DiningMySubmissionResponseSchema,
	type DiningReportReason,
	type DiningSubmissionCreate,
	DiningSubmissionCreateSchema,
	DiningSubmissionPageSchema,
	DiningSubmissionReportCreateSchema,
	DiningSubmissionResponseSchema,
	DiningSubmissionReviewCreateSchema,
	DiningSubmissionReviewPageSchema,
	DiningSubmissionReviewSchema,
	DiningSubmissionRevisionSchema,
	type DiningSubmissionUpdate,
	DiningSubmissionUpdateSchema,
} from "@campus-agent/dining/domain";
import { z } from "zod";
import { requestJson } from "@/platform/api/client";

interface PageInput {
	cursor?: string | null;
	signal?: AbortSignal;
}

function pageQuery(cursor?: string | null) {
	const query = new URLSearchParams({ limit: "20" });
	if (cursor) {
		query.set("cursor", cursor);
	}
	return query;
}

function submissionBody(
	metadata: DiningSubmissionCreate | DiningSubmissionUpdate,
	photo: File | null,
) {
	if ((metadata.photoAction === "replace") !== Boolean(photo)) {
		throw new Error("请选择替换照片，或调整照片操作。");
	}
	if (photo) {
		const body = new FormData();
		body.set("metadata", JSON.stringify(metadata));
		body.set("photo", photo);
		return { body };
	}
	return { body: JSON.stringify(metadata), headers: { "content-type": "application/json" } };
}

export async function getDiningSubmissions(input: PageInput & { windowId: string }) {
	return DiningSubmissionPageSchema.parse(
		await requestJson<unknown>({
			path: `/api/dining/windows/${encodeURIComponent(input.windowId)}/submissions?${pageQuery(input.cursor)}`,
			...(input.signal ? { signal: input.signal } : {}),
		}),
	);
}

export async function getDiningSubmission(
	submissionId: string,
	input: { signal?: AbortSignal } = {},
) {
	return DiningSubmissionResponseSchema.parse(
		await requestJson<unknown>({
			path: `/api/dining/submissions/${encodeURIComponent(submissionId)}`,
			...(input.signal ? { signal: input.signal } : {}),
		}),
	);
}

export async function getMyDiningSubmissions(input: PageInput = {}) {
	return DiningMySubmissionPageSchema.parse(
		await requestJson<unknown>({
			path: `/api/dining/me/submissions?${pageQuery(input.cursor)}`,
			...(input.signal ? { signal: input.signal } : {}),
		}),
	);
}

export async function getMyDiningSubmission(
	submissionId: string,
	input: { signal?: AbortSignal } = {},
) {
	return DiningMySubmissionResponseSchema.parse(
		await requestJson<unknown>({
			path: `/api/dining/me/submissions/${encodeURIComponent(submissionId)}`,
			...(input.signal ? { signal: input.signal } : {}),
		}),
	);
}

export async function createDiningSubmission(input: {
	windowId: string;
	idempotencyKey: string;
	metadata: DiningSubmissionCreate;
	photo: File | null;
}) {
	const body = submissionBody(DiningSubmissionCreateSchema.parse(input.metadata), input.photo);
	return DiningMySubmissionResponseSchema.parse(
		await requestJson<unknown>({
			...body,
			headers: { ...body.headers, "idempotency-key": input.idempotencyKey },
			method: "POST",
			path: `/api/dining/windows/${encodeURIComponent(input.windowId)}/submissions`,
		}),
	);
}

export async function updateDiningSubmission(input: {
	submissionId: string;
	revision: number;
	metadata: DiningSubmissionUpdate;
	photo: File | null;
}) {
	const body = submissionBody(DiningSubmissionUpdateSchema.parse(input.metadata), input.photo);
	return DiningMySubmissionResponseSchema.parse(
		await requestJson<unknown>({
			...body,
			headers: {
				...body.headers,
				"if-match": `"${DiningSubmissionRevisionSchema.parse(input.revision)}"`,
			},
			method: "PATCH",
			path: `/api/dining/me/submissions/${encodeURIComponent(input.submissionId)}`,
		}),
	);
}

export async function deleteDiningSubmission(input: {
	submissionId: string;
	revision: number;
}): Promise<void> {
	await requestJson<void>({
		headers: { "if-match": `"${DiningSubmissionRevisionSchema.parse(input.revision)}"` },
		method: "DELETE",
		path: `/api/dining/me/submissions/${encodeURIComponent(input.submissionId)}`,
	});
}

const reportResponse = z.object({ reportId: z.string().min(1) }).strict();
export async function reportDiningSubmission(input: {
	submissionId: string;
	reason: DiningReportReason;
	details: string | null;
}) {
	return reportResponse.parse(
		await requestJson<unknown>({
			body: JSON.stringify(
				DiningSubmissionReportCreateSchema.parse({ reason: input.reason, details: input.details }),
			),
			headers: { "content-type": "application/json" },
			method: "POST",
			path: `/api/dining/submissions/${encodeURIComponent(input.submissionId)}/reports`,
		}),
	);
}

export async function getDiningSubmissionReviews(input: PageInput & { submissionId: string }) {
	return DiningSubmissionReviewPageSchema.parse(
		await requestJson<unknown>({
			path: `/api/dining/submissions/${encodeURIComponent(input.submissionId)}/reviews?${pageQuery(input.cursor)}`,
			...(input.signal ? { signal: input.signal } : {}),
		}),
	);
}

export async function createDiningSubmissionReview(input: {
	submissionId: string;
	anonymous: boolean;
	body: string;
	idempotencyKey: string;
}) {
	const response = await requestJson<unknown>({
		body: JSON.stringify(
			DiningSubmissionReviewCreateSchema.parse({ anonymous: input.anonymous, body: input.body }),
		),
		headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
		method: "POST",
		path: `/api/dining/submissions/${encodeURIComponent(input.submissionId)}/reviews`,
	});
	return z.object({ review: DiningSubmissionReviewSchema }).strict().parse(response).review;
}
