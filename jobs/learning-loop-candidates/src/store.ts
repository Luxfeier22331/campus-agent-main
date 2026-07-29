import { Client } from "pg";
import type { CandidateSourceRow } from "./types";

export interface CandidateSelectionStore {
	selectRows(input: { since: string; limit: number }): Promise<CandidateSourceRow[]>;
	close(): Promise<void>;
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function nonNegativeInteger(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function nullableInteger(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isInteger(parsed) ? parsed : null;
}

function toCandidateSourceRow(row: Record<string, unknown>): CandidateSourceRow {
	return {
		cachedInputTokens: nonNegativeInteger(row.cached_input_tokens),
		durationMs: nullableInteger(row.duration_ms),
		errorCode: nullableString(row.error_code),
		failClosed: typeof row.fail_closed === "boolean" ? row.fail_closed : null,
		feedbackId: nullableString(row.feedback_id),
		feedbackUpdatedAt:
			row.feedback_updated_at === null || row.feedback_updated_at === undefined
				? null
				: new Date(String(row.feedback_updated_at)).toISOString(),
		inputTokens: nonNegativeInteger(row.input_tokens),
		modelName: nullableString(row.model_name),
		modelProvider: nullableString(row.model_provider),
		outputTokens: nonNegativeInteger(row.output_tokens),
		projectionLagMs: nullableInteger(row.projection_lag_ms),
		reasonCodes: toStringArray(row.reason_codes_json),
		requestId: String(row.request_id),
		status: String(row.status),
		stageTiming:
			typeof row.stage_timing_json === "object" && row.stage_timing_json !== null
				? (row.stage_timing_json as Record<string, unknown>)
				: null,
		traceAvailable: row.trace_available === true,
		totalTokens: nonNegativeInteger(row.total_tokens),
		vote: nullableString(row.vote),
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
						o.fail_closed,
						o.model_provider,
						o.model_name,
						o.input_tokens,
						o.cached_input_tokens,
						o.output_tokens,
						o.total_tokens,
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
