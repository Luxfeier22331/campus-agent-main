import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import type { DocsAppProjection, DocsReleaseManifest, ObjectRef } from "./types.ts";

const schemasRoot = resolve(import.meta.dirname, "../../../packages/contracts/schemas");
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const projectionValidator = ajv.compile(loadSchema("campus-docs-app-projection.v1.schema.json"));
const manifestValidator = ajv.compile(loadSchema("campus-docs-release-manifest.v1.schema.json"));

export function parseProjection(value: unknown): DocsAppProjection {
	if (!projectionValidator(value)) {
		throw new Error(`invalid docs app projection: ${ajv.errorsText(projectionValidator.errors)}`);
	}
	return value as DocsAppProjection;
}

export function parseReleaseManifest(value: unknown): DocsReleaseManifest {
	if (!manifestValidator(value)) {
		throw new Error(`invalid docs release manifest: ${ajv.errorsText(manifestValidator.errors)}`);
	}
	return value as DocsReleaseManifest;
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

function loadSchema(name: string): object {
	return JSON.parse(readFileSync(resolve(schemasRoot, name), "utf8")) as object;
}
