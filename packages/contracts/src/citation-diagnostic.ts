import { z } from "zod";

export const CITATION_REASONS = {
	missing_field: "引用字段缺失",
	invalid_type: "引用字段类型错误",
	invalid_url: "来源 URL 无效",
	invalid_offset: "引用偏移非法",
	span_out_of_bounds: "引用区间超出正文",
	span_text_mismatch: "引用片段与正文不匹配",
	span_overlap: "引用区间重叠",
	duplicate_evidence_id: "证据 ID 重复",
	source_index_conflict: "同一来源对应多个编号",
	duplicate_citation_index: "引用编号重复",
	invalid_marker: "引用标记非法",
	missing_evidence: "引用编号没有对应证据",
	invalid_source_identity: "来源身份无效",
	missing_source_reference: "来源引用缺失",
	unsupported_source: "来源类型不支持引用",
	web_search_without_citations: "已搜索但没有引用",
	citations_without_web_search: "引用与搜索事实不一致",
} as const;
export type CitationReason = keyof typeof CITATION_REASONS;
export const CITATION_STAGES = ["provider_annotation", "evidence_mapping", "finalization"] as const;
export const CITATION_STAGE_LABELS: Record<(typeof CITATION_STAGES)[number], string> = {
	provider_annotation: "上游引用解析",
	evidence_mapping: "证据映射",
	finalization: "最终引用校验",
};
export const CitationStageSchema = z.enum(CITATION_STAGES);
export const FailureReasonSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const index = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const observedNumber = z.number().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const CitationDiagnosticSchema = z
	.object({
		schema_version: z.literal(1),
		validation_stage: CitationStageSchema,
		field: z
			.string()
			.regex(/^[a-z][a-z0-9_.]{0,127}$/)
			.optional(),
		item_index: index.optional(),
		citation_index: observedNumber.optional(),
		start: observedNumber.optional(),
		end: observedNumber.optional(),
		text_length: index.optional(),
		offset_unit: z.enum(["utf16_code_unit", "unicode_code_point", "utf8_byte"]).optional(),
		actual_type: z
			.enum(["missing", "null", "string", "number", "boolean", "array", "object"])
			.optional(),
	})
	.strict()
	.refine(
		(value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2048,
		"citation diagnostic exceeds 2 KiB",
	);
export type CitationDiagnostic = z.infer<typeof CitationDiagnosticSchema>;
