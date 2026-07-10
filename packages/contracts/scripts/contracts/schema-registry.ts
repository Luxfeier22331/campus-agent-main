import Ajv2020, { type AnySchema } from "ajv/dist/2020.js";
import {
	isRecord,
	listFilesMatching,
	loadJson,
	loadYaml,
	relativePath,
	repoPath,
	requiredString,
	requirePath,
} from "./common.ts";
import { validateJsonArtifactInvariants } from "./schema-invariants.ts";

const registryPath = repoPath("packages/contracts/schemas/contract-schema-registry.v1.json");
const registrySchemaPath = repoPath(
	"packages/contracts/schemas/contract-schema-registry.v1.schema.json",
);
const jsonSchemaDialect = "https://json-schema.org/draft/2020-12/schema";
const openApiVersion = "3.1.1";

interface SchemaRegistryEntry {
	fixtureGroups: { invalidGlob: string; path: string; validGlob: string }[];
	id: string;
	kind: string;
	owner: string;
	path: string;
	status: string;
	validates: string[];
}

export function checkContractSchemas({
	registry = registryPath,
}: {
	registry?: string;
} = {}): void {
	const registrySchema = loadJson(registrySchemaPath);
	const registryPayload = loadJson(registry);
	validateJsonSchemaDocument(registrySchemaPath, registrySchema);
	validateInstance("contract-schema-registry.v1.json", registrySchema, registryPayload);

	for (const entry of registryEntries(registryPayload)) {
		if (entry.kind === "openapi_wire") {
			validateOpenApiDocument(entry.path);
			continue;
		}
		if (entry.kind === "json_artifact") {
			validateJsonSchemaEntry(entry);
			continue;
		}
		if (entry.kind === "language_local" || entry.kind === "legacy_helper") {
			requirePath(entry.path);
			continue;
		}
		throw new Error(`${entry.id}: unsupported schema registry kind: ${entry.kind}`);
	}
}

function validateJsonSchemaEntry(entry: SchemaRegistryEntry): void {
	const schema = loadJson(entry.path);
	validateJsonSchemaDocument(entry.path, schema);
	const validator = compileSchema(entry.path, schema);

	for (const target of entry.validates) {
		const instance = loadJson(target);
		validateInstance(relativePath(target), schema, instance);
		validateJsonArtifactInvariants(entry.id, target, instance);
	}

	for (const group of entry.fixtureGroups) {
		const groupDir = repoPath(group.path);
		requirePath(groupDir);
		const validFixtures = listFilesMatching(groupDir, group.validGlob);
		const invalidFixtures = listFilesMatching(groupDir, group.invalidGlob);
		if (validFixtures.length === 0) {
			throw new Error(`${entry.id}: fixture group has no valid fixtures: ${groupDir}`);
		}
		if (invalidFixtures.length === 0) {
			throw new Error(`${entry.id}: fixture group has no invalid fixtures: ${groupDir}`);
		}
		for (const fixture of validFixtures) {
			const instance = validateWithValidator(validator, fixture, true);
			validateJsonArtifactInvariants(entry.id, fixture, instance);
		}
		for (const fixture of invalidFixtures) {
			validateInvalidFixture(validator, entry.id, fixture);
		}
	}
}

function validateJsonSchemaDocument(path: string, schema: unknown): void {
	if (!isRecord(schema)) {
		throw new Error(`${relativePath(path)} must contain a JSON Schema object`);
	}
	if (schema.$schema !== jsonSchemaDialect) {
		throw new Error(`${relativePath(path)} must declare JSON Schema 2020-12`);
	}
	for (const key of ["$id", "title"]) {
		const value = schema[key];
		if (typeof value !== "string" || value.trim() === "") {
			throw new Error(`${relativePath(path)} must declare non-empty ${key}`);
		}
	}
	const rootType = schema.type;
	if (rootType !== undefined && rootType !== "object") {
		throw new Error(`${relativePath(path)} root schema type must be object`);
	}
	const ajv = newAjv();
	if (!ajv.validateSchema(schema)) {
		throw new Error(
			`${relativePath(path)} is not a valid Draft 2020-12 schema: ${ajv.errorsText()}`,
		);
	}
}

function validateOpenApiDocument(path: string): void {
	const doc = loadYaml(path);
	if (!isRecord(doc)) {
		throw new Error(`${relativePath(path)} must contain an OpenAPI object`);
	}
	if (doc.openapi !== openApiVersion) {
		throw new Error(`${relativePath(path)} must use OpenAPI ${openApiVersion}`);
	}
	if (doc.jsonSchemaDialect !== jsonSchemaDialect) {
		throw new Error(`${relativePath(path)} must use JSON Schema 2020-12`);
	}
	if (!isRecord(doc.info) || typeof doc.info.title !== "string") {
		throw new Error(`${relativePath(path)} must declare info.title`);
	}
	if (!isRecord(doc.paths) || Object.keys(doc.paths).length === 0) {
		throw new Error(`${relativePath(path)} must declare paths`);
	}
	if (!(isRecord(doc.components) && isRecord(doc.components.schemas))) {
		throw new Error(`${relativePath(path)} must declare components.schemas`);
	}
}

function validateInstance(name: string, schema: unknown, instance: unknown): void {
	const validator = compileSchema(name, schema);
	if (!validator(instance)) {
		const first = validator.errors?.[0];
		throw new Error(
			`${name} failed schema validation at ${first?.instancePath || "/"}: ${first?.message ?? "unknown error"}`,
		);
	}
}

function validateWithValidator(
	validator: ReturnType<ReturnType<typeof newAjv>["compile"]>,
	fixturePath: string,
	shouldPass: boolean,
): unknown {
	const instance = loadJson(fixturePath);
	const passed = validator(instance);
	if (shouldPass && !passed) {
		const first = validator.errors?.[0];
		throw new Error(
			`${relativePath(fixturePath)} should be valid but failed at ${first?.instancePath || "/"}: ${first?.message ?? "unknown error"}`,
		);
	}
	if (!shouldPass && passed) {
		throw new Error(`${relativePath(fixturePath)} should be invalid but passed`);
	}
	return instance;
}

function validateInvalidFixture(
	validator: ReturnType<ReturnType<typeof newAjv>["compile"]>,
	entryId: string,
	fixturePath: string,
): void {
	const instance = loadJson(fixturePath);
	if (!validator(instance)) {
		return;
	}
	try {
		validateJsonArtifactInvariants(entryId, fixturePath, instance);
	} catch {
		return;
	}
	throw new Error(`${relativePath(fixturePath)} should be invalid but passed`);
}

function registryEntries(registry: unknown): SchemaRegistryEntry[] {
	if (!(isRecord(registry) && Array.isArray(registry.entries))) {
		throw new Error("contract schema registry entries must be a list");
	}
	const seen = new Set<string>();
	return registry.entries.map((raw) => {
		if (!isRecord(raw)) {
			throw new Error("contract schema registry entries must be objects");
		}
		const id = requiredString(raw, "id");
		if (seen.has(id)) {
			throw new Error(`duplicate contract schema registry id: ${id}`);
		}
		seen.add(id);
		return {
			id,
			kind: requiredString(raw, "kind"),
			path: repoPath(requiredString(raw, "path")),
			owner: requiredString(raw, "owner"),
			status: requiredString(raw, "status"),
			validates: Array.isArray(raw.validates)
				? raw.validates.filter((item): item is string => typeof item === "string").map(repoPath)
				: [],
			fixtureGroups: Array.isArray(raw.fixture_groups)
				? raw.fixture_groups.filter(isRecord).map((group) => ({
						path: requiredString(group, "path"),
						validGlob: requiredString(group, "valid_glob"),
						invalidGlob: requiredString(group, "invalid_glob"),
					}))
				: [],
		};
	});
}

function compileSchema(
	name: string,
	schema: unknown,
): ReturnType<ReturnType<typeof newAjv>["compile"]> {
	try {
		return newAjv().compile(schema as AnySchema);
	} catch (error) {
		throw new Error(
			`${relativePath(name)} is not a valid Draft 2020-12 schema: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function newAjv(): Ajv2020 {
	return new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
}
