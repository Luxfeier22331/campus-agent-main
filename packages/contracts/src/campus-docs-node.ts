import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import courseMapsSchema from "../schemas/campus-docs-course-maps.v1.schema.json" with {
	type: "json",
};
import readerSchema from "../schemas/campus-docs-reader.v3.schema.json" with { type: "json" };
import sourceSchema from "../schemas/campus-docs-source.v4.schema.json" with { type: "json" };

import { parseDocsReaderContract } from "./campus-docs-reader.ts";
import type {
	DocsCourseMaps,
	DocsReader,
	DocsSourceManifest,
	ObjectRef,
} from "./campus-docs-types.ts";

export {
	buildReaderRouteSlug,
	normalizeSourceManifest,
	selectCurrentVersion,
} from "./campus-docs-source.ts";
export { DOCS_SOURCE_KEY } from "./campus-docs-types.ts";

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

export function parseObjectRef(value: unknown): ObjectRef {
	if (!(value && typeof value === "object" && !Array.isArray(value))) {
		throw new Error("object ref must be an object");
	}
	const record = value as Record<string, unknown>;
	if (
		typeof record.key !== "string" ||
		!record.key.trim() ||
		typeof record.byteSize !== "number" ||
		!Number.isSafeInteger(record.byteSize) ||
		record.byteSize < 1 ||
		typeof record.sha256 !== "string" ||
		!/^sha256:[a-f0-9]{64}$/u.test(record.sha256)
	) {
		throw new Error("object ref requires key, positive byteSize and sha256 digest");
	}
	return {
		byteSize: record.byteSize,
		key: record.key,
		sha256: record.sha256 as `sha256:${string}`,
	};
}

function validate<T>(value: unknown, validator: ValidateFunction<T>, label: string): T {
	if (!validator(value)) {
		throw new Error(`invalid ${label}: ${ajv.errorsText(validator.errors)}`);
	}
	return value;
}
