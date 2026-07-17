import { resolve } from "node:path";

import {
	syncCampusPublishedReaderAssets,
	syncCampusPublishedReaderDocs,
} from "../src/docs-reader-build/sync-campus-published-reader.ts";
import {
	cleanupPublishedReaderFixture,
	createPublishedReaderFixture,
} from "../test/helpers/published-reader-fixture.ts";

const fixture = createPublishedReaderFixture({ publicDocumentSlug: "doc-c62077b20430" });

try {
	await syncCampusPublishedReaderAssets({
		client: fixture.client,
		manifestFilePath: fixture.manifestPath,
		targetRoot: resolve("public"),
	});
	await syncCampusPublishedReaderDocs({
		client: fixture.client,
		docsRoot: resolve(".generated/docs"),
		manifestFilePath: fixture.manifestPath,
	});
} finally {
	cleanupPublishedReaderFixture();
}
