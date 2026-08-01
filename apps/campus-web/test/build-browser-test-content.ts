import { buildCampusWeb } from "../scripts/build-campus-web.ts";
import {
	cleanupDocsSourceFixture,
	createDocsSourceSiteFixture,
} from "./helpers/docs-source-fixture.ts";

async function main(): Promise<void> {
	const fixture = createDocsSourceSiteFixture();
	try {
		await buildCampusWeb({ docsClient: fixture.client, refreshDocs: true, staging: false });
	} finally {
		cleanupDocsSourceFixture();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack || error.message : String(error));
	process.exit(1);
});
