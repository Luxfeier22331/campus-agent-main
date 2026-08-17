import { type SQL, sql } from "drizzle-orm";

export function withStreamOrchestrationOverhead(
	timing: SQL<Record<string, unknown>>,
): SQL<Record<string, unknown>> {
	return sql<Record<string, unknown>>`case
		when jsonb_typeof(${timing} -> 'stream.app_api_ttft_ms') = 'number'
			and jsonb_typeof(${timing} -> 'agent.first_delta_ms') = 'number'
			and (${timing} ->> 'stream.app_api_ttft_ms')::double precision >= 0
			and (${timing} ->> 'agent.first_delta_ms')::double precision >= 0
			and (${timing} ->> 'agent.first_delta_ms')::double precision
				<= (${timing} ->> 'stream.app_api_ttft_ms')::double precision
		then jsonb_set(
			${timing},
			array['stream.orchestration_overhead_ms'],
			to_jsonb(
				(${timing} ->> 'stream.app_api_ttft_ms')::double precision
					- (${timing} ->> 'agent.first_delta_ms')::double precision
			),
			true
		)
		else ${timing}
	end`;
}
