import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createTransactionalIndexCatalog } from "../src/catalog.ts";
const enabled = Boolean(process.env.RAG_TEST_DATABASE_URL);
describe.skipIf(!enabled)("index activation database contract", () => {
	it("preserves previous on lost acknowledgement, rejects obsolete rounds, protects registered versions", async () => {
		const client = new Client({ connectionString: process.env.RAG_TEST_DATABASE_URL });
		await client.connect(); await client.query("BEGIN");
		try {
			const catalog = createTransactionalIndexCatalog(client);
			const input = (letter: string) => ({ collection: `campus_docs_${letter.repeat(64)}`, docsEmbeddingSet: `sha256:${letter.repeat(64)}` as const, noticeEmbeddingSet: `sha256:${letter.repeat(64)}` as const, producer: "automatic" as const });
			const a = input("a"), b = input("b"), c = input("c");
			for (const v of [a, b, c]) { await catalog.register(v); await catalog.markValidated(v.collection); }
			await catalog.activate(a);
			await catalog.activate({ ...b, expectedCurrent: a.collection });
			expect(await catalog.activate({ ...b, expectedCurrent: a.collection })).toEqual({ noOp: true });
			expect(await catalog.activate({ ...c, expectedCurrent: a.collection })).toEqual({ noOp: true, obsolete: true });
			const row = (await client.query("SELECT collection, previous_collection FROM campus_docs_serving.current_index WHERE singleton")).rows[0];
			expect(row).toEqual({ collection: b.collection, previous_collection: a.collection });
			const rollback = { collection: a.collection, expectedCurrent: b.collection };
			expect(await catalog.activate(rollback)).toEqual({ noOp: false });
			// Lost completion acknowledgement retries the original rollback, never the new previous.
			expect(await catalog.activate(rollback)).toEqual({ noOp: true });
			expect((await client.query("SELECT collection, previous_collection FROM campus_docs_serving.current_index WHERE singleton")).rows[0])
				.toEqual({ collection: a.collection, previous_collection: b.collection });
			await catalog.activate({ collection: c.collection, expectedCurrent: a.collection });
			expect(await catalog.activate(rollback)).toEqual({ noOp: true, obsolete: true });
			expect(await catalog.register(b)).toEqual({ rebuildIncomplete: false });
			const incomplete = input("d"); await catalog.register(incomplete);
			expect(await catalog.register(incomplete)).toEqual({ rebuildIncomplete: true });
			await expect(catalog.activate(incomplete)).rejects.toThrow("validated version");
		} finally { await client.query("ROLLBACK"); await client.end(); }
	});
});
