import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import courseMapsSchema from "../../../schemas/campus-docs-course-maps.v1.schema.json" with {
	type: "json",
};
import readerSchema from "../../../schemas/campus-docs-reader.v3.schema.json" with { type: "json" };
import sourceSchema from "../../../schemas/campus-docs-source.v4.schema.json" with { type: "json" };

import { parseDocsReaderContract } from "../reader.ts";
import type { DocsCourseMaps, DocsReader, DocsSourceManifest } from "../types.ts";

export { DOCS_SOURCE_KEY } from "../constants.ts";
export {
	assertDocsSourceRelationships,
	buildReaderRouteSlug,
	normalizeSourceManifest,
	selectCurrentVersion,
} from "./source.ts";

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const sourceValidator = ajv.compile(sourceSchema) as ValidateFunction<DocsSourceManifest>;
const readerValidator = ajv.compile(readerSchema);
const courseMapsValidator = ajv.compile(courseMapsSchema) as ValidateFunction<DocsCourseMaps>;

export function parseSourceManifest(value: unknown): DocsSourceManifest {
	return validate(value, sourceValidator, "docs source manifest");
}

export function parseReader(value: unknown): DocsReader {
	return parseDocsReaderContract(validate(value, readerValidator, "docs reader"));
}

export function parseCourseMaps(value: unknown): DocsCourseMaps {
	return validate(value, courseMapsValidator, "docs course maps");
}

function validate<T>(value: unknown, validator: ValidateFunction<T>, label: string): T {
	if (!validator(value)) {
		throw new Error(`invalid ${label}: ${ajv.errorsText(validator.errors)}`);
	}
	return value;
}
