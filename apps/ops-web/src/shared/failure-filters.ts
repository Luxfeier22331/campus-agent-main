import { CitationStageSchema, FailureReasonSchema } from "campus-contracts/citation-diagnostic";
import { z } from "zod";
export const failureFilterShape = {
	failureCode: FailureReasonSchema.optional(),
	failureReason: FailureReasonSchema.optional(),
	citationStage: CitationStageSchema.optional(),
	failureScope: z.enum(["any", "stage", "terminal"]).optional(),
};
export const FailureFiltersSchema = z.object(failureFilterShape);
export type FailureFilters = z.infer<typeof FailureFiltersSchema>;
export function hasFailureFilters(query: FailureFilters): boolean {
	return Boolean(
		query.failureCode || query.failureReason || query.citationStage || query.failureScope,
	);
}
export function readFailureFilters(search: Record<string, unknown>): FailureFilters {
	return Object.fromEntries(
		Object.entries(failureFilterShape).flatMap(([key, schema]) => {
			const parsed = schema.safeParse(search[key]);
			return parsed.success && parsed.data ? [[key, parsed.data]] : [];
		}),
	);
}
