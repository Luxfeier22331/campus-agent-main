import { DOCS_SOURCE_KEY } from "campus-contracts/campus-docs";
import { createDocsSourceSiteFixture } from "campus-contracts/campus-docs-fixture";
import { createS3ObjectStore } from "../src/docs-reader-build/published-reader-object-store.ts";
import type { ReaderObjectStoreWriter } from "../src/docs-reader-build/published-reader-types.ts";

export interface SeedLocalDocsSourceResult {
	objectCount: number;
	status: "created" | "existing";
}

export async function seedLocalDocsSource(
	client: ReaderObjectStoreWriter,
): Promise<SeedLocalDocsSourceResult> {
	if (await client.readOptionalBytesObject({ key: DOCS_SOURCE_KEY })) {
		return { objectCount: 0, status: "existing" };
	}

	const fixture = createDocsSourceSiteFixture();
	const source = fixture.objects.get(DOCS_SOURCE_KEY);
	if (!source) {
		throw new Error(`docs fixture is missing ${DOCS_SOURCE_KEY}`);
	}
	const referencedObjects = [...fixture.objects.entries()]
		.filter(([key]) => key !== DOCS_SOURCE_KEY)
		.sort(([left], [right]) => left.localeCompare(right));
	for (let offset = 0; offset < referencedObjects.length; offset += 4) {
		const writes = await Promise.allSettled(
			referencedObjects
				.slice(offset, offset + 4)
				.map(([key, object]) => client.writeBytesObject({ ...object, key })),
		);
		const failure = writes.find((write) => write.status === "rejected");
		if (failure?.status === "rejected") {
			throw failure.reason;
		}
	}
	await client.writeBytesObject({ ...source, key: DOCS_SOURCE_KEY });
	return { objectCount: fixture.objects.size, status: "created" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	seedLocalDocsSource(createS3ObjectStore())
		.then((result) => console.log(JSON.stringify(result)))
		.catch((error) => {
			console.error(error instanceof Error ? error.stack || error.message : String(error));
			process.exit(1);
		});
}
