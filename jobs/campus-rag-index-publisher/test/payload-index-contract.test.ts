import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RETRIEVAL_PAYLOAD_INDEXES } from "../src/definitions.ts";

describe("Campus RAG payload index contract", () => {
	it("matches the shared point fixture", () => {
		const contract = JSON.parse(
			readFileSync(
				new URL(
					"../../../packages/contracts/fixtures/campus_rag/payload-indexes.v3.json",
					import.meta.url,
				),
				"utf8",
			),
		) as {
			schemaVersion: string;
			payloadIndexes: Array<{ field: string; type: string }>;
		};

		expect(contract.schemaVersion).toBe("campus_rag_point.v3");
		expect(RETRIEVAL_PAYLOAD_INDEXES).toEqual(
			contract.payloadIndexes.map(({ field, type }) => ({ fieldName: field, fieldSchema: type })),
		);
	});
});
