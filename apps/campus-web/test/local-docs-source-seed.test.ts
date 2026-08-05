import { describe, expect, it } from "vitest";

import { createDocsSourceSiteFixture } from "../fixtures/docs-source-site.ts";
import { seedLocalDocsSource } from "../scripts/seed-local-docs-source.ts";
import type { ReaderObjectStoreWriter } from "../src/docs-reader-build/published-reader-types.ts";
import { DOCS_SOURCE_KEY } from "../src/docs-reader-build/source-catalog.ts";

describe("Campus Web 本地文档来源初始化", () => {
	it("先写全部引用对象，最后提交固定来源键", async () => {
		const store = createMemoryStore();
		const fixture = createDocsSourceSiteFixture();

		await expect(seedLocalDocsSource(store.client)).resolves.toEqual({
			objectCount: fixture.objects.size,
			status: "created",
		});
		expect(store.writes).toHaveLength(fixture.objects.size);
		expect(store.writes.at(-1)).toBe(DOCS_SOURCE_KEY);
		expect(store.objects.get(DOCS_SOURCE_KEY)).toEqual(fixture.sourceBytes);
	});

	it("固定来源键已存在时不覆盖任何对象", async () => {
		const existing = new TextEncoder().encode("existing");
		const store = createMemoryStore(new Map([[DOCS_SOURCE_KEY, existing]]));

		await expect(seedLocalDocsSource(store.client)).resolves.toEqual({
			objectCount: 0,
			status: "existing",
		});
		expect(store.writes).toEqual([]);
		expect(store.objects.get(DOCS_SOURCE_KEY)).toBe(existing);
	});

	it("引用对象写入中断时不提交来源键，重试可以补齐", async () => {
		const store = createMemoryStore();
		store.failNextWrite = true;

		await expect(seedLocalDocsSource(store.client)).rejects.toThrow("interrupted fixture write");
		expect(store.objects.has(DOCS_SOURCE_KEY)).toBe(false);

		await expect(seedLocalDocsSource(store.client)).resolves.toMatchObject({ status: "created" });
		expect(store.writes.at(-1)).toBe(DOCS_SOURCE_KEY);
		expect(store.objects.has(DOCS_SOURCE_KEY)).toBe(true);
	});
});

function createMemoryStore(initial = new Map<string, Uint8Array>()): {
	client: ReaderObjectStoreWriter;
	failNextWrite: boolean;
	objects: Map<string, Uint8Array>;
	writes: string[];
} {
	const store: {
		client: ReaderObjectStoreWriter;
		failNextWrite: boolean;
		objects: Map<string, Uint8Array>;
		writes: string[];
	} = {
		client: undefined as unknown as ReaderObjectStoreWriter,
		failNextWrite: false,
		objects: new Map(initial),
		writes: [] as string[],
	};
	store.client = {
		async readOptionalBytesObject({ key }) {
			return store.objects.get(key);
		},
		async writeBytesObject({ body, key }) {
			if (store.failNextWrite) {
				store.failNextWrite = false;
				throw new Error("interrupted fixture write");
			}
			store.objects.set(key, body);
			store.writes.push(key);
		},
	};
	return store;
}
