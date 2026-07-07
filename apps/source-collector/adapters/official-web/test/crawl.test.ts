import { describe } from "vitest";

import { registerCrawlCliSuite } from "./crawl-cli.suite";
import { registerCrawlControlPlaneSuite } from "./crawl-control-plane.suite";
import { registerCrawlCoreSuite } from "./crawl-core.suite";

describe("source-collector official-web adapter crawl shell", () => {
	registerCrawlCoreSuite();
	registerCrawlControlPlaneSuite();
	registerCrawlCliSuite();
});
