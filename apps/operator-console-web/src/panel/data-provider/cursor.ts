import { type GetListParams, HttpError } from "react-admin";

import { fetchJson } from "../http";

const MAX_SEQUENTIAL_CURSOR_KEYS = 64;
const sequentialPageCursors = new Map<string, Map<number, string | null>>();

export interface SequentialCursorListResult<RecordType> {
	data: RecordType[];
	pageInfo: {
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
	total?: number;
}

export function normalizeFilterValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildCursorKey(input: {
	resource: string;
	filter: GetListParams["filter"];
	perPage: number;
}) {
	const entries = Object.entries(input.filter ?? {})
		.map(([key, value]) => [key, normalizeFilterValue(value)] as const)
		.filter(([, value]) => Boolean(value))
		.sort(([left], [right]) => left.localeCompare(right));

	return JSON.stringify({
		entries,
		perPage: input.perPage,
		resource: input.resource,
	});
}

function getCursorHistory(cursorKey: string) {
	let history = sequentialPageCursors.get(cursorKey);
	if (!history) {
		if (sequentialPageCursors.size >= MAX_SEQUENTIAL_CURSOR_KEYS) {
			const oldestKey = sequentialPageCursors.keys().next().value;
			if (oldestKey) {
				sequentialPageCursors.delete(oldestKey);
			}
		}
		history = new Map<number, string | null>([[1, null]]);
		sequentialPageCursors.set(cursorKey, history);
	}

	return history;
}

export function clearSequentialCursorHistory() {
	sequentialPageCursors.clear();
}

function pruneCursorHistory(history: Map<number, string | null>, currentPage: number) {
	for (const knownPage of [...history.keys()]) {
		if (knownPage > currentPage) {
			history.delete(knownPage);
		}
	}
}

export async function getSequentialCursorList<
	RawResponse extends {
		page: {
			nextCursor: string | null;
		};
	},
	RawRecord,
	RecordType,
>(input: {
	buildQuery(query: URLSearchParams): void;
	cursorFilter: GetListParams["filter"];
	normalizeRecord(record: RawRecord): RecordType;
	page?: number;
	perPage?: number;
	resource: string;
	resourceLabel: string;
	responseItems(payload: RawResponse): RawRecord[];
	signal?: AbortSignal;
	sourcePath: string;
}): Promise<SequentialCursorListResult<RecordType>> {
	const perPage = input.perPage ?? 20;
	const page = input.page ?? 1;
	const cursorKey = buildCursorKey({
		filter: input.cursorFilter,
		perPage,
		resource: input.resource,
	});
	const cursorHistory = getCursorHistory(cursorKey);

	if (page > 1 && !cursorHistory.has(page)) {
		throw new HttpError(
			`Operator Console ${input.resourceLabel} pagination currently supports sequential next-page navigation only.`,
			400,
			{
				error: {
					code: "cursor_not_available",
					message: `Operator Console ${input.resourceLabel} pagination currently supports sequential next-page navigation only.`,
				},
			},
		);
	}

	const query = new URLSearchParams();
	query.set("limit", String(perPage));
	input.buildQuery(query);

	const cursor = cursorHistory.get(page);
	if (cursor) {
		query.set("cursor", cursor);
	}

	const payload = await fetchJson<RawResponse>(`${input.sourcePath}?${query.toString()}`, {
		signal: input.signal,
	});
	pruneCursorHistory(cursorHistory, page);
	if (payload.page.nextCursor) {
		cursorHistory.set(page + 1, payload.page.nextCursor);
	}

	const data = input.responseItems(payload).map(input.normalizeRecord);
	const hasNextPage = Boolean(payload.page.nextCursor);
	const exactTotal = hasNextPage ? undefined : (page - 1) * perPage + data.length;

	return {
		data,
		pageInfo: {
			hasNextPage,
			hasPreviousPage: page > 1,
		},
		total: exactTotal,
	};
}
