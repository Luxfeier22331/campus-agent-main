import { describe, expect, it } from "vitest";

import { assertSameBinding } from "../src/catalog.ts";
import type { CurrentIndexBinding } from "../src/types.ts";
import { INDEX_DEFINITION } from "../src/types.ts";

const binding: CurrentIndexBinding = {
	collection: `campus_docs_${"a".repeat(64)}`,
	dense_vector_name: INDEX_DEFINITION.embedding.vectorName,
	embedding_dimensions: INDEX_DEFINITION.embedding.dimensions,
	embedding_model: INDEX_DEFINITION.embedding.model,
	embedding_provider: INDEX_DEFINITION.embedding.provider,
	embedding_query_instruction: INDEX_DEFINITION.embedding.queryInstruction,
	embedding_space_id: "qwen3-embedding-4b-test-v1",
	sparse_model: INDEX_DEFINITION.sparse.model,
	sparse_vector_name: INDEX_DEFINITION.sparse.vectorName,
};

describe("Campus docs index catalog", () => {
	it("accepts an identical current binding", () => {
		expect(() => assertSameBinding({ ...binding }, binding)).not.toThrow();
	});

	it("rejects conflicting query fields for the same collection", () => {
		expect(() =>
			assertSameBinding(
				{ ...binding, embedding_query_instruction: "changed" as typeof binding.embedding_query_instruction },
				binding,
			),
		).toThrow("Campus docs current index conflicts at embedding_query_instruction");
	});
});
