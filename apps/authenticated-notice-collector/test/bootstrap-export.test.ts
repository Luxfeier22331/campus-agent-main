import fs from "node:fs";

import { afterEach, describe } from "vitest";

import { registerBootstrapExportBundleRecordSuite } from "./bootstrap-export.bundle-record.suite.js";
import { registerBootstrapExportCollectionSuite } from "./bootstrap-export.collection.suite.js";
import { registerBootstrapExportWriteArtifactsSuite } from "./bootstrap-export.write-artifacts.suite.js";
import { registerCollectorRunLedgerSuite } from "./collector-run-ledger.suite.js";

describe("authenticated notice collector bootstrap export", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	registerBootstrapExportBundleRecordSuite();
	registerBootstrapExportCollectionSuite();
	registerBootstrapExportWriteArtifactsSuite(tempDirs);
	registerCollectorRunLedgerSuite();
});
