import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { repoPath } from "./common.ts";

interface Schema {
	type?: string;
	const?: unknown;
	enum?: unknown[];
	$ref?: string;
	oneOf?: Schema[];
	anyOf?: Schema[];
	items?: Schema;
	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: boolean | Schema;
	"x-go-package"?: string;
	"x-go-name"?: string;
	"x-go-type"?: string;
}
function tsType(s: Schema): string {
	if (s.$ref) {
		return s.$ref.slice(s.$ref.lastIndexOf("/") + 1);
	}
	if (s.const !== undefined) {
		return JSON.stringify(s.const);
	}
	if (s.enum) {
		return s.enum.map((v) => JSON.stringify(v)).join(" | ");
	}
	const variants = s.oneOf ?? s.anyOf;
	if (variants) {
		return variants.map(tsType).join(" | ");
	}
	if (s.type === "array") {
		assert(s.items, "Array schema requires items");
		const item = tsType(s.items);
		return `${item.includes(" | ") ? `(${item})` : item}[]`;
	}
	if (s.type === "object") {
		if (s.properties && Object.keys(s.properties).length === 0) {
			return "Record<string, never>";
		}
		if (!s.properties) {
			return `Record<string, ${typeof s.additionalProperties === "object" ? tsType(s.additionalProperties) : "unknown"}>`;
		}
		return `{\n${Object.entries(s.properties)
			.map(
				([name, field]) =>
					`${JSON.stringify(name)}${s.required?.includes(name) ? "" : "?"}: ${tsType(field)};`,
			)
			.join("\n")}\n}`;
	}
	if (s.type === "integer" || s.type === "number") {
		return "number";
	}
	return s.type ?? "unknown";
}
export function generateAgentRuntimeContract({ check = false }: { check?: boolean } = {}): void {
	const schema = JSON.parse(
		readFileSync(
			repoPath("packages/contracts/schemas/agent-runtime-control.v1.schema.json"),
			"utf8",
		),
	) as { $defs: Record<string, Schema> };
	const header = "// Code generated from agent-runtime-control.v1.schema.json. DO NOT EDIT.\n";
	const outputs = new Map<string, string>();
	outputs.set(
		repoPath("packages/contracts/src/generated/agent-runtime-control.ts"),
		header +
			Object.entries(schema.$defs)
				.map(([name, s]) =>
					s.type === "object" && s.properties && Object.keys(s.properties).length > 0
						? `export interface ${name} ${tsType(s)}`
						: `export type ${name} = ${tsType(s)};`,
				)
				.join("\n\n") +
			"\n",
	);
	const groups = new Map<string, string[]>();
	for (const s of Object.values(schema.$defs)) {
		const pkg = s["x-go-package"];
		if (!pkg) {
			continue;
		}
		assert(s.properties, "Go struct schema requires properties");
		const fields = Object.entries(s.properties).map(([key, f]) => {
			// omitempty reflects wire optionality. Required nullable values retain their Go pointer.
			const optional = !s.required?.includes(key);
			return `${f["x-go-name"]} ${f["x-go-type"]} \`json:"${key}${optional ? ",omitempty" : ""}"\``;
		});
		const members = groups.get(pkg) ?? [];
		members.push(`type ${s["x-go-name"]} struct {\n${fields.join("\n")}\n}`);
		groups.set(pkg, members);
	}
	const paths: Record<string, string> = {
		executionapplication: "executionapplication",
		operation: "executionapplication/operation",
		executioncontract: "executioncontract",
		agentruntimeprotocol: "agentruntimeprotocol",
		runtimeprojection: "runtimeprojection",
		runtimeapi: "runtimeapi",
	};
	const imports: Record<string, string> = {
		time: "time",
		json: "encoding/json",
		execution: "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution",
		executioncontract:
			"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract",
		operation:
			"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation",
		runtimeprojection:
			"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/runtimeprojection",
	};
	for (const [pkg, members] of groups) {
		const body = members.join("\n\n");
		const used = Object.entries(imports).filter(([alias]) =>
			new RegExp(`\\b${alias}\\.`).test(body),
		);
		const raw =
			header +
			`package ${pkg}\n` +
			(used.length > 0
				? `import (\n${used.map(([, path]) => JSON.stringify(path)).join("\n")}\n)\n`
				: "") +
			body +
			"\n";
		const fmt = spawnSync("gofmt", [], { input: raw, encoding: "utf8" });
		if (fmt.status !== 0) {
			throw new Error(fmt.stderr);
		}
		outputs.set(
			repoPath(`apps/agent-control/internal/${paths[pkg]}/runtime_contract_generated.go`),
			fmt.stdout,
		);
	}
	for (const [path, raw] of outputs) {
		let text = raw;
		if (path.endsWith(".ts")) {
			const formatted = spawnSync(
				"pnpm",
				[
					"exec",
					"biome",
					"format",
					"--stdin-file-path=packages/contracts/src/generated/agent-runtime-control.ts",
				],
				{ cwd: repoPath(""), input: raw, encoding: "utf8" },
			);
			if (formatted.status !== 0) {
				throw new Error(formatted.stderr);
			}
			text = formatted.stdout;
		}
		if (check) {
			if (readFileSync(path, "utf8") !== text) {
				throw new Error(`runtime contract generated file is stale: ${path}`);
			}
		} else {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, text);
		}
	}
}
