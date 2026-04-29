import { registerBootstrapExportCollectionAttachmentsSuite } from "./bootstrap-export.collection.attachments.suite";
import { registerBootstrapExportCollectionPagesSuite } from "./bootstrap-export.collection.pages.suite";
import { registerBootstrapExportCollectionValidationSuite } from "./bootstrap-export.collection.validation.suite";

export function registerBootstrapExportCollectionSuite(): void {
	registerBootstrapExportCollectionPagesSuite();
	registerBootstrapExportCollectionValidationSuite();
	registerBootstrapExportCollectionAttachmentsSuite();
}
