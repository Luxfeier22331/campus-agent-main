export const RETRIEVAL_PAYLOAD_INDEXES = [
	{ fieldName: "source_kind", fieldSchema: "keyword" },
	{ fieldName: "version_slug", fieldSchema: "keyword" },
	{ fieldName: "is_current", fieldSchema: "bool" },
	{ fieldName: "corpus", fieldSchema: "keyword" },
	{ fieldName: "applicable_from_admission_year", fieldSchema: "integer" },
	{ fieldName: "applicable_to_admission_year", fieldSchema: "integer" },
] as const;

export const COLLECTION_DEFINITION = {
	dense: {
		distance: "Cosine",
		queryInstruction:
			"Given a Campus Web question, retrieve relevant passages from Campus Docs and published Notices that answer the query.",
		vectorName: "dense",
	},
	pointSchemaVersion: "campus_rag_point.v3",
	payloadIndexes: RETRIEVAL_PAYLOAD_INDEXES,
	sparse: {
		language: "none",
		model: "fnv1a_log_tf.v1",
		modifier: "idf",
		provider: "campus-agent",
		tokenizer: "unicode_word_v1",
		vectorName: "sparse",
	},
} as const;

export const COLLECTION_PREFIX = "campus_docs" as const;
