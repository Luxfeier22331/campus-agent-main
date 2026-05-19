import { registerBootstrapExportCollectionAttachmentsSuite } from "./bootstrap-export.collection.attachments.suite.js";
import { registerBootstrapExportCollectionPagesSuite } from "./bootstrap-export.collection.pages.suite.js";
import { registerBootstrapExportCollectionValidationSuite } from "./bootstrap-export.collection.validation.suite.js";

export function registerBootstrapExportCollectionSuite(): void {
	registerBootstrapExportCollectionPagesSuite();
	registerBootstrapExportCollectionValidationSuite();
	registerBootstrapExportCollectionAttachmentsSuite();
}
