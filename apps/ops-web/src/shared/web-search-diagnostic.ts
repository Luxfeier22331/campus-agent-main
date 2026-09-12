import { z } from "zod";

const count = z.number().int().nonnegative();
export const WebSearchDiagnosticSchema = z.object({
	schema_version: z.literal(1),
	state: z.enum(["not_used", "sources_available", "metadata_only", "unmapped"]),
	query_count: count,
	chunk_count: count,
	support_count: count,
	converted_count: count,
	discarded_count: count,
	discard_reasons: z.object({
		invalid_segment: count.optional(),
		invalid_source: count.optional(),
		answer_unmapped: count.optional(),
	}),
});
