import { Client } from "pg";
import type { CandidateSourceRow } from "./types";

export interface CandidateSelectionStore {
	selectRows(input: { since: string; limit: number }): Promise<CandidateSourceRow[]>;
	close(): Promise<void>;
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toCandidateSourceRow(row: Record<string, unknown>): CandidateSourceRow {
	return {
		durationMs: typeof row.duration_ms === "number" ? row.duration_ms : null,
		errorCode: typeof row.error_code === "string" ? row.error_code : null,
		failClosed: typeof row.fail_closed === "boolean" ? row.fail_closed : null,
		feedbackId: String(row.feedback_id),
		feedbackUpdatedAt: new Date(String(row.feedback_updated_at)).toISOString(),
		modelExecutionDetail:
			typeof row.model_execution_detail === "string" ? row.model_execution_detail : null,
		modelExecutionState:
			typeof row.model_execution_state === "string" ? row.model_execution_state : null,
		modelName: typeof row.model_name === "string" ? row.model_name : null,
		modelProvider: typeof row.model_provider === "string" ? row.model_provider : null,
		projectionLagMs: typeof row.projection_lag_ms === "number" ? row.projection_lag_ms : null,
		reasonCodes: toStringArray(row.reason_codes_json),
		requestId: String(row.request_id),
		requestedTool: typeof row.requested_tool === "string" ? row.requested_tool : null,
		retrievalAdequacyReason:
			typeof row.retrieval_adequacy_reason === "string" ? row.retrieval_adequacy_reason : null,
		retrievalAdequacyVerdict:
			typeof row.retrieval_adequacy_verdict === "string" ? row.retrieval_adequacy_verdict : null,
		retrievalAttempted:
			typeof row.retrieval_attempted === "boolean" ? row.retrieval_attempted : null,
		retrievedSourceCount:
			typeof row.retrieved_source_count === "number" ? row.retrieved_source_count : null,
		selectedTool: typeof row.selected_tool === "string" ? row.selected_tool : null,
		status: String(row.status),
		stageTiming:
			typeof row.stage_timing_json === "object" && row.stage_timing_json !== null
				? (row.stage_timing_json as Record<string, unknown>)
				: null,
		toolBusinessOutcome:
			typeof row.tool_business_outcome === "string" ? row.tool_business_outcome : null,
		toolFailCloseReason:
			typeof row.tool_fail_close_reason === "string" ? row.tool_fail_close_reason : null,
		traceAvailable: row.trace_available === true,
		vote: String(row.vote),
	};
}

export function createPostgresCandidateSelectionStore(input: {
	connectionString: string;
}): CandidateSelectionStore {
	const client = new Client({ connectionString: input.connectionString });
	let connected = false;

	async function ensureConnected(): Promise<void> {
		if (!connected) {
			await client.connect();
			connected = true;
		}
	}

	return {
		async close() {
			if (connected) {
				await client.end();
				connected = false;
			}
		},
		async selectRows(input) {
			await ensureConnected();
			const result = await client.query(
				`
					select
						f.feedback_id,
						f.request_id,
						f.vote,
						f.reason_codes_json,
						f.updated_at as feedback_updated_at,
						o.status,
						o.error_code,
						o.selected_tool,
						o.requested_tool,
						o.tool_fail_close_reason,
						o.tool_business_outcome,
						o.fail_closed,
						o.retrieval_attempted,
						o.retrieved_source_count,
						o.retrieval_adequacy_verdict,
						o.retrieval_adequacy_reason,
						o.model_provider,
						o.model_name,
						o.model_execution_state,
						o.model_execution_detail,
						o.duration_ms,
						o.trace_available,
						o.projection_lag_ms,
						o.stage_timing_json
					from chat.message_feedback f
					join runtime.request_observability_fact o on o.request_id = f.request_id
					where f.updated_at >= $1::timestamptz
					order by f.updated_at desc, f.feedback_id desc
					limit $2
				`,
				[input.since, input.limit],
			);
			return result.rows.map((row) => toCandidateSourceRow(row));
		},
	};
}
