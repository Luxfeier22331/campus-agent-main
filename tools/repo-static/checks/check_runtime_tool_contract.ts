import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

export interface RuntimeToolContractIssue {
	path: string;
	message: string;
}

export function auditRuntimeToolContract(root = repoRoot): RuntimeToolContractIssue[] {
	const issues: RuntimeToolContractIssue[] = [];
	const registryPath = "configs/runtime/tools.v4.json";
	const functionSchemasPath = "configs/runtime/tool-function-schemas.v1.json";
	const generatedContractPath =
		"apps/app-api/src/modules/integration/generated/tool-execution-contract.ts";
	const registry = readToolRegistry(join(root, registryPath));
	const functionSchemaToolNames = readToolFunctionSchemaNames(join(root, functionSchemasPath));
	const generated = parseGeneratedToolContract(join(root, generatedContractPath));
	const allRegistryTools = registry.map((tool) => tool.name);
	const modelVisibleRegistryTools = registry
		.filter((tool) => tool.exposure === "model_visible")
		.map((tool) => tool.name);
	const requestableRegistryTools = registry
		.filter((tool) => tool.exposure !== "internal_only")
		.map((tool) => tool.name);

	issues.push(
		...expectSubset({
			actual: generated.TOOL_IDS,
			expected: allRegistryTools,
			message: "generated TOOL_IDS must cover runtime tool registry names",
			path: generatedContractPath,
		}),
		...expectSameSet({
			actual: generated.MODEL_VISIBLE_TOOL_NAMES,
			expected: modelVisibleRegistryTools,
			message: "generated MODEL_VISIBLE_TOOL_NAMES must match model_visible runtime tools",
			path: generatedContractPath,
		}),
		...expectSubset({
			actual: generated.REQUESTED_TOOLS,
			expected: requestableRegistryTools,
			message: "generated REQUESTED_TOOLS must cover non-internal runtime tools",
			path: generatedContractPath,
		}),
		...expectSameSet({
			actual: functionSchemaToolNames,
			expected: modelVisibleRegistryTools,
			message: "tool function schemas must match model_visible runtime tools",
			path: functionSchemasPath,
		}),
	);

	if (modelVisibleRegistryTools.includes("place_lookup")) {
		issues.push({
			path: registryPath,
			message: "place_lookup must not be model-visible until navigation runtime opens",
		});
	}
	return issues;
}

function runSelfTest(): number {
	expectNoIssues(auditRuntimeToolContract(repoRoot), "current runtime tool contract");
	withFixture((root) => {
		writeRuntimeToolConfig(root, [
			{ name: "knowledge_query", exposure: "model_visible" },
			{ name: "place_lookup", exposure: "model_visible" },
		]);
		writeToolFunctionSchemas(root, ["knowledge_query", "place_lookup"]);
		writeGeneratedToolContract(root, {
			MODEL_VISIBLE_TOOL_NAMES: ["knowledge_query", "place_lookup"],
			REQUESTED_TOOLS: ["knowledge_query", "place_lookup"],
			TOOL_IDS: ["knowledge_query", "place_lookup"],
		});
		expectIssue(auditRuntimeToolContract(root), {
			path: "configs/runtime/tools.v4.json",
			message: "place_lookup must not be model-visible until navigation runtime opens",
		});
	});
	withFixture((root) => {
		writeRuntimeToolConfig(root, [
			{ name: "knowledge_query", exposure: "model_visible" },
			{ name: "public_web_search", exposure: "model_visible" },
		]);
		writeToolFunctionSchemas(root, ["knowledge_query"]);
		writeGeneratedToolContract(root, {
			MODEL_VISIBLE_TOOL_NAMES: ["knowledge_query", "public_web_search"],
			REQUESTED_TOOLS: ["knowledge_query", "public_web_search"],
			TOOL_IDS: ["knowledge_query", "public_web_search"],
		});
		expectIssue(auditRuntimeToolContract(root), {
			path: "configs/runtime/tool-function-schemas.v1.json",
			message:
				"tool function schemas must match model_visible runtime tools; missing: public_web_search",
		});
	});
	withFixture((root) => {
		writeRuntimeToolConfig(root, [
			{ name: "knowledge_query", exposure: "model_visible" },
			{ name: "public_web_search", exposure: "model_visible" },
		]);
		writeToolFunctionSchemas(root, ["knowledge_query", "public_web_search"]);
		writeGeneratedToolContract(root, {
			MODEL_VISIBLE_TOOL_NAMES: ["knowledge_query"],
			REQUESTED_TOOLS: ["knowledge_query", "public_web_search"],
			TOOL_IDS: ["knowledge_query", "public_web_search"],
		});
		expectIssue(auditRuntimeToolContract(root), {
			path: "apps/app-api/src/modules/integration/generated/tool-execution-contract.ts",
			message:
				"generated MODEL_VISIBLE_TOOL_NAMES must match model_visible runtime tools; missing: public_web_search",
		});
	});
	console.log("check_runtime_tool_contract self-test passed.");
	return 0;
}

function expectNoIssues(issues: unknown[], label: string): void {
	if (issues.length > 0) {
		throw new Error(`${label} should pass, got ${JSON.stringify(issues)}`);
	}
}

function expectIssue(issues: RuntimeToolContractIssue[], expected: RuntimeToolContractIssue): void {
	if (!issues.some((issue) => issue.path === expected.path && issue.message === expected.message)) {
		throw new Error(
			`missing expected issue ${JSON.stringify(expected)} in ${JSON.stringify(issues)}`,
		);
	}
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "runtime-tool-contract-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function readText(path: string): string {
	return readFileSync(path, "utf8");
}

function writeText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}

interface RuntimeTool {
	exposure: string;
	name: string;
}

function readToolRegistry(path: string): RuntimeTool[] {
	const payload = JSON.parse(readText(path)) as unknown;
	if (!(isRecord(payload) && Array.isArray(payload.tools))) {
		throw new Error(`${path} must define tools[]`);
	}
	return payload.tools.map((tool, index) => {
		if (!isRecord(tool) || typeof tool.name !== "string" || typeof tool.exposure !== "string") {
			throw new Error(`${path} tools[${index}] must define string name and exposure`);
		}
		return { exposure: tool.exposure, name: tool.name };
	});
}

function readToolFunctionSchemaNames(path: string): string[] {
	const payload = JSON.parse(readText(path)) as unknown;
	if (!(isRecord(payload) && Array.isArray(payload.tools))) {
		throw new Error(`${path} must define tools[]`);
	}
	return payload.tools.map((tool, index) => {
		if (!isRecord(tool) || typeof tool.name !== "string") {
			throw new Error(`${path} tools[${index}] must define string name`);
		}
		return tool.name;
	});
}

function parseGeneratedToolContract(path: string): Record<string, string[]> {
	const text = readText(path);
	return {
		MODEL_VISIBLE_TOOL_NAMES: parseConstStringArray(text, "MODEL_VISIBLE_TOOL_NAMES", path),
		REQUESTED_TOOLS: parseConstStringArray(text, "REQUESTED_TOOLS", path),
		TOOL_IDS: parseConstStringArray(text, "TOOL_IDS", path),
	};
}

function parseConstStringArray(text: string, name: string, path: string): string[] {
	const match = text.match(new RegExp(`export const ${name} = \\[(.*?)\\] as const;`, "s"));
	if (!match?.[1]) {
		throw new Error(`${path} must export ${name}`);
	}
	const values = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1] ?? "");
	if (values.some((value) => value === "")) {
		throw new Error(`${path} ${name} contains an empty value`);
	}
	return values;
}

function expectSameSet(input: {
	actual: string[];
	expected: string[];
	message: string;
	path: string;
}): RuntimeToolContractIssue[] {
	const actual = new Set(input.actual);
	const expected = new Set(input.expected);
	const missing = [...expected].filter((value) => !actual.has(value)).sort();
	const extra = [...actual].filter((value) => !expected.has(value)).sort();
	if (missing.length === 0 && extra.length === 0) {
		return [];
	}
	const details = [
		missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
		extra.length > 0 ? `extra: ${extra.join(", ")}` : "",
	]
		.filter(Boolean)
		.join("; ");
	return [{ path: input.path, message: `${input.message}; ${details}` }];
}

function expectSubset(input: {
	actual: string[];
	expected: string[];
	message: string;
	path: string;
}): RuntimeToolContractIssue[] {
	const actual = new Set(input.actual);
	const missing = [...new Set(input.expected)].filter((value) => !actual.has(value)).sort();
	return missing.length === 0
		? []
		: [{ path: input.path, message: `${input.message}; missing: ${missing.join(", ")}` }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeRuntimeToolConfig(root: string, tools: RuntimeTool[]): void {
	writeText(join(root, "configs/runtime/tools.v4.json"), JSON.stringify({ tools }));
}

function writeToolFunctionSchemas(root: string, names: string[]): void {
	writeText(
		join(root, "configs/runtime/tool-function-schemas.v1.json"),
		JSON.stringify({ tools: names.map((name) => ({ name })) }),
	);
}

function writeGeneratedToolContract(root: string, arrays: Record<string, string[]>): void {
	const lines = Object.entries(arrays).map(
		([name, values]) =>
			`export const ${name} = [${values.map((value) => `"${value}"`).join(", ")}] as const;`,
	);
	writeText(
		join(root, "apps/app-api/src/modules/integration/generated/tool-execution-contract.ts"),
		`${lines.join("\n")}\n`,
	);
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const issues = auditRuntimeToolContract();
	if (issues.length > 0) {
		console.error("Runtime tool contract check failed:");
		for (const issue of issues) {
			console.error(`- ${issue.path}: ${issue.message}`);
		}
		return 1;
	}
	console.log("Validated runtime tool contract.");
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
