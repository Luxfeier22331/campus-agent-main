import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";

import type { DocsCourseMaps, DocsReader, DocsSourceManifest, ObjectRef } from "./source-types.ts";

const schemasRoot = resolve(import.meta.dirname, "../../../../packages/contracts/schemas");
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const sourceValidator = compile("campus-docs-source.v3.schema.json");
const readerValidator = compile("campus-docs-reader.v3.schema.json");
const courseMapsValidator = compile("campus-docs-course-maps.v1.schema.json");

export function parseSourceManifest(value: unknown): DocsSourceManifest {
	return validate(value, sourceValidator, "docs source manifest") as DocsSourceManifest;
}

export function parseReader(value: unknown): DocsReader {
	return validate(value, readerValidator, "docs reader") as DocsReader;
}

export function parseCourseMaps(value: unknown): DocsCourseMaps {
	return validate(value, courseMapsValidator, "docs course maps") as DocsCourseMaps;
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

function compile(name: string): ValidateFunction {
	return ajv.compile(JSON.parse(readFileSync(resolve(schemasRoot, name), "utf8")) as object);
}

function validate(value: unknown, validator: ValidateFunction, label: string): unknown {
	if (!validator(value)) {
		throw new Error(`invalid ${label}: ${ajv.errorsText(validator.errors)}`);
	}
	return value;
}
