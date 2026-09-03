import { createDocsSourceSiteFixture } from "campus-contracts/campus-docs/fixture";
import { buildCampusWeb } from "../scripts/build-campus-web.ts";

async function main(): Promise<void> {
	const fixture = createDocsSourceSiteFixture();
	await buildCampusWeb({ docsClient: fixture.client, refreshDocs: true, staging: false });
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack || error.message : String(error));
	process.exit(1);
});
