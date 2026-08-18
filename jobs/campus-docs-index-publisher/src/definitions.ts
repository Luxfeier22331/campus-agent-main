export const CHUNK_SET_DEFINITION = {
	chunking: {
		algorithm: "campus_docs_reader_elements.v4",
		maxChars: 1600,
		overlapChars: 0,
		targetChars: 800,
	},
	readerSchemaVersion: "campus_docs_reader.v3",
	sourceSchemaVersion: "campus_docs_source.v3",
} as const;

export const EMBEDDING_SPACE = {
	dimensions: 2560,
	spaceId: "qwen3-embedding-4b@2560-v1",
} as const;

export const COLLECTION_DEFINITION = {
	dense: {
		distance: "Cosine",
		queryInstruction:
			"Given a Campus Web document question, retrieve relevant current passages that answer the query.",
		vectorName: "dense",
	},
	pointSchemaVersion: "campus_docs_point.v3",
	sparse: {
		language: "none",
		model: "fnv1a_log_tf.v1",
		modifier: "idf",
		provider: "campus-agent",
		tokenizer: "unicode_word_v1",
		vectorName: "sparse",
	},
} as const;
