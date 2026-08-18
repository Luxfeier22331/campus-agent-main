import { describe, expect, it } from "vitest";

import { assertSameBinding } from "../src/catalog.ts";
import { COLLECTION_DEFINITION, EMBEDDING_SPACE } from "../src/definitions.ts";
import type { CurrentIndexBinding } from "../src/types.ts";

const binding: CurrentIndexBinding = {
	collection: `campus_docs_${"a".repeat(64)}`,
	dense_vector_name: COLLECTION_DEFINITION.dense.vectorName,
	embedding_dimensions: EMBEDDING_SPACE.dimensions,
	embedding_query_instruction: COLLECTION_DEFINITION.dense.queryInstruction,
	embedding_space_id: EMBEDDING_SPACE.spaceId,
	sparse_model: COLLECTION_DEFINITION.sparse.model,
	sparse_vector_name: COLLECTION_DEFINITION.sparse.vectorName,
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
