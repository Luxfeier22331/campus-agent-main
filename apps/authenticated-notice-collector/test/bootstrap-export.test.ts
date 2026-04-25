import fs from "node:fs";

import { afterEach, describe } from "vitest";

import { registerBootstrapExportBundleRecordSuite } from "./bootstrap-export.bundle-record.suite";
import { registerBootstrapExportCollectionSuite } from "./bootstrap-export.collection.suite";
import { registerBootstrapExportWriteArtifactsSuite } from "./bootstrap-export.write-artifacts.suite";
import { registerCollectorRunLedgerSuite } from "./collector-run-ledger.suite";

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
