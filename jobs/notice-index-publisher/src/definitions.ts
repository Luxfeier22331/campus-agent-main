export interface NoticeChunkDefinition {
	algorithm: string;
	maxChars: number;
	overlapChars: number;
	targetChars: number;
}

export const NOTICE_CHUNK_DEFINITION = {
	algorithm: "notice_text_structure.v11",
	maxChars: 1200,
	overlapChars: 0,
	targetChars: 800,
} as const satisfies NoticeChunkDefinition;

export const NOTICE_CHUNK_RUN_SCHEMA_VERSION = "notice_chunk_run.v2" as const;
export const NOTICE_CHUNK_VALIDATION_SCHEMA_VERSION = "notice_chunk_validation.v3" as const;

export const MAX_HEADING_CHARS = 80;
export const TINY_CHUNK_CHARS = 120;

export const BASELINE_CHUNK_DEFINITION = {
	algorithm: "notice_line_length.v0",
	maxChars: 1600,
	overlapChars: 0,
	targetChars: 800,
} as const;
