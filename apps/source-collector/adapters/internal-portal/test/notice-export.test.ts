import fs from "node:fs";

import { afterEach, describe } from "vitest";
import { registerInternalPortalRunLedgerSuite } from "./internal-portal-run-ledger.suite.js";
import { registerNoticeExportBundleRecordSuite } from "./notice-export.bundle-record.suite.js";
import { registerNoticeExportCollectionSuite } from "./notice-export.collection.suite.js";
import { registerNoticeExportWriteArtifactsSuite } from "./notice-export.write-artifacts.suite.js";

describe("internal portal source collector notice export", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	registerNoticeExportBundleRecordSuite();
	registerNoticeExportCollectionSuite();
	registerNoticeExportWriteArtifactsSuite(tempDirs);
	registerInternalPortalRunLedgerSuite();
});
