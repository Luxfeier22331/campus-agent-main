import { registerNoticeExportCollectionAttachmentsSuite } from "./notice-export.collection.attachments.suite.js";
import { registerNoticeExportCollectionPagesSuite } from "./notice-export.collection.pages.suite.js";
import { registerNoticeExportCollectionValidationSuite } from "./notice-export.collection.validation.suite.js";

export function registerNoticeExportCollectionSuite(): void {
	registerNoticeExportCollectionPagesSuite();
	registerNoticeExportCollectionValidationSuite();
	registerNoticeExportCollectionAttachmentsSuite();
}
