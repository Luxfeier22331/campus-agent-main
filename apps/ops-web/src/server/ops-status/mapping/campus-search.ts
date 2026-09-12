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
		return { diagnosticState: "UNAVAILABLE", reason: "Campus Search 诊断查询不可用。", calls: [] };
	}
	if (rows === undefined || rows.length === 0) {
		return {
			diagnosticState: "NO_DATA",
			reason: "没有 Campus Search 观察记录；旧请求不会回填。",
			calls: [],
		};
	}
	let partial = false;
	const calls = rows.map((row): CampusSearchDiagnostics["calls"][number] => {
		const raw = (row.snapshot ?? {}) as Record<string, unknown>;
		const parsed = CampusSearchSnapshotSchema.safeParse({
			...raw,
			candidates: Array.isArray(raw.candidates)
				? raw.candidates.map((candidate) => ({
						...candidate,
						cited:
							row.citedResultRefs === null
								? null
								: row.citedResultRefs.includes(candidate.resultRef),
					}))
				: [],
		});
		const snapshot = row.schemaVersion === 2 && parsed.success ? parsed.data : null;
		const retrieved = Boolean(row.phaseTimes.retrieved);
		const reranked = Boolean(row.phaseTimes.reranked);
		const missing =
			row.status === "running" ||
			!snapshot ||
			!row.phaseTimes.queued ||
			((row.status === "failed" || row.status === "canceled") &&
				!(row.phaseTimes[row.status] && snapshot?.failedStage)) ||
			(row.status === "completed" &&
				!(
					row.phaseTimes.completed &&
					row.phaseTimes.received &&
					row.phaseTimes.index_loaded &&
					row.phaseTimes.embedded &&
					retrieved &&
					row.phaseTimes.selected &&
					row.phaseTimes.dispatching &&
					snapshot?.durations.embedding !== undefined &&
					snapshot?.durations.retrieval !== undefined &&
					snapshot?.durations.selection !== undefined &&
					snapshot?.embedding?.cacheOutcome &&
					snapshot.retrieval &&
					snapshot.retrieval.httpMs !== null &&
					snapshot.retrieval.decodeMs !== null &&
					snapshot.retrieval.postprocessMs !== null &&
					(snapshot.retrievedCount === 0 ||
						(reranked &&
							snapshot.durations.rerank !== undefined &&
							snapshot.rerank?.httpMs !== null &&
							snapshot.rerank))
				)) ||
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
			citedCount:
				row.citedResultRefs === null || !snapshot
					? null
					: snapshot.candidates.filter((candidate) => candidate.returned && candidate.cited).length,
			failureCode: row.failureCode,
			httpStatus: row.httpStatus,
			snapshot,
			updatedAt: row.updatedAt.toISOString(),
		};
	});
	return {
		diagnosticState: partial ? "PARTIAL" : "COMPLETE",
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
