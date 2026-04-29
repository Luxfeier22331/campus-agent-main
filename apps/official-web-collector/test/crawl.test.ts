import { describe } from "vitest";

import { registerCrawlCliSuite } from "./crawl-cli.suite";
import { registerCrawlControlPlaneSuite } from "./crawl-control-plane.suite";
import { registerCrawlCoreSuite } from "./crawl-core.suite";

describe("official-web-collector crawl shell", () => {
	registerCrawlCoreSuite();
	registerCrawlControlPlaneSuite();
	registerCrawlCliSuite();
});
