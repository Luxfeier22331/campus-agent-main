import { createDevDiningSeed } from "@campus-agent/dining/domain";

import { postgresUrlFromEnv } from "../src/config.ts";
import { PostgresDiningDevSeedImporter } from "../src/dev-seed-importer.ts";

const seed = createDevDiningSeed();
await new PostgresDiningDevSeedImporter(postgresUrlFromEnv()).import(seed);
console.log(
	JSON.stringify({
		hallCount: seed.draft.halls.length,
		offeringCount: seed.draft.menuOfferings.length,
		reviewCount: seed.reviews.length,
		status: "dev_seed_imported",
	}),
);
