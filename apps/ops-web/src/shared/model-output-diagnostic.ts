import { z } from "zod";

export const ModelOutputDiagnosticSchema = z.object({
	schema_version: z.literal(1),
	text: z.string().max(65536),
	original_utf8_bytes: z.number().int().nonnegative(),
	truncated: z.boolean(),
	validation_stage: z.enum(["json_parse", "schema_validation"]),
	validation_message: z.string().max(1024),
	output_schema: z.string().max(128),
	finish_reason: z.string().max(128).nullable(),
});

export type ModelOutputDiagnostic = z.infer<typeof ModelOutputDiagnosticSchema>;
