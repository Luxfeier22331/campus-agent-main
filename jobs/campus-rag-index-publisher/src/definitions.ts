export const COLLECTION_DEFINITION = {
	dense: {
		distance: "Cosine",
		queryInstruction:
			"Given a Campus Web question, retrieve relevant passages from Campus Docs and published Notices that answer the query.",
		vectorName: "dense",
	},
	pointSchemaVersion: "campus_rag_point.v2",
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
