import { describe } from "vitest";

import { registerCrawlCoreSuite } from "./crawl-core.suite";

describe("source-collector official-web adapter crawl shell", () => {
	registerCrawlCoreSuite();
});
