import { describe } from "vitest";

import { registerPageArtifactsCoreSuite } from "./page-artifacts-core.suite";
import { registerPageArtifactsDetailSuite } from "./page-artifacts-detail.suite";
import { registerPageArtifactsDirectoryShellSuite } from "./page-artifacts-directory-shell.suite";
import { registerPageArtifactsListingSuite } from "./page-artifacts-listing.suite";
import { registerPageArtifactsTableSuite } from "./page-artifacts-table.suite";
import { registerPageArtifactsXiaoyouRecoverySuite } from "./page-artifacts-xiaoyou-recovery.suite";

describe("official-web-collector page artifacts", () => {
	registerPageArtifactsCoreSuite();
	registerPageArtifactsListingSuite();
	registerPageArtifactsDetailSuite();
	registerPageArtifactsDirectoryShellSuite();
	registerPageArtifactsXiaoyouRecoverySuite();
	registerPageArtifactsTableSuite();
});
