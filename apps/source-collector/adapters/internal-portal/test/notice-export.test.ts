import { describe } from "vitest";
import { registerNoticeExportBundleRecordSuite } from "./notice-export.bundle-record.suite.js";
import { registerNoticeExportCollectionSuite } from "./notice-export.collection.suite.js";

describe("internal portal source collector notice export", () => {
	registerNoticeExportBundleRecordSuite();
	registerNoticeExportCollectionSuite();
});
