import {
	type CampusSearchDiagnostics,
	CampusSearchSnapshotSchema,
} from "../../../shared/campus-search-diagnostics.ts";
import type { CampusSearchDiagnosticRow } from "../store/types.ts";

export function toCampusSearchDiagnostics(
	rows: CampusSearchDiagnosticRow[] | null | undefined,
	finished: boolean,
): CampusSearchDiagnostics {
	if (rows === null) {
		return { dataState: "UNAVAILABLE", reason: "Campus Search 诊断查询不可用。", calls: [] };
	}
	if (rows === undefined || rows.length === 0) {
		return {
			dataState: "NO_DATA",
			reason: "没有 Campus Search 观察记录；旧请求不会回填。",
			calls: [],
		};
	}
	let partial = false;
	const calls = rows.map((row): CampusSearchDiagnostics["calls"][number] => {
		const raw = row.snapshot as Record<string, unknown>;
		const parsed = CampusSearchSnapshotSchema.safeParse({
			...raw,
			candidates: Array.isArray(raw.candidates)
				? raw.candidates.map((candidate) => ({
						...candidate,
						cited:
							candidate.returned && row.citedResultRefs !== null
								? row.citedResultRefs.includes(candidate.resultRef)
								: null,
					}))
				: [],
		});
		const snapshot = row.schemaVersion === 1 && parsed.success ? parsed.data : null;
		const missing =
			row.status === "running" ||
			!row.phaseTimes.queued ||
			(row.status === "completed" &&
				!(row.phaseTimes.selected && row.phaseTimes.dispatching && snapshot)) ||
			snapshot?.snapshotTruncated ||
			(finished && row.status === "completed" && row.citedResultRefs === null);
		partial ||= Boolean(missing);
		const terminalAt = row.phaseTimes.completed ?? row.phaseTimes.failed ?? row.phaseTimes.canceled;
		return {
			invocationId: row.invocationId,
			workflowStepId: row.workflowStepId,
			activityAttempt: row.activityAttempt,
			searchQuery: row.searchQuery,
			status: finished && row.status === "running" ? "incomplete" : row.status,
			currentPhase: row.currentPhase,
			phaseTimes: row.phaseTimes,
			queueMs: elapsed(row.phaseTimes.queued, row.phaseTimes.dispatching),
			toolTotalMs: elapsed(row.phaseTimes.dispatching, terminalAt),
			failureCode: row.failureCode,
			httpStatus: row.httpStatus,
			snapshot,
			updatedAt: row.updatedAt.toISOString(),
		};
	});
	return {
		dataState: partial ? "PARTIAL" : "FRESH",
		reason: partial ? "调用仍在进行，或部分观察、候选快照、引用记录缺失。" : null,
		calls,
	};
}

function elapsed(start: string | undefined, end: string | undefined): number | null {
	if (!(start && end)) {
		return null;
	}
	const duration = Date.parse(end) - Date.parse(start);
	return Number.isFinite(duration) && duration >= 0 ? duration : null;
}
