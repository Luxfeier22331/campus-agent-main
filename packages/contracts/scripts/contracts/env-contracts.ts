import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { parseEnv } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { parse as parseToml } from "smol-toml";
import * as ts from "typescript";
import YAML from "yaml";
import { repoPath } from "./common.ts";

export interface EnvContractSource {
	environment?: string;
	ignore?: string[];
	jobs?: string[];
	kind: "compose" | "go" | "kubernetes" | "otel" | "typescript" | "workflow" | "wrangler";
	path: string;
	rejects?: string[];
	resources?: string[];
	services?: string[];
}

export interface EnvContractConsumer {
	doctor_surfaces?: string[];
	id: string;
	sources?: EnvContractSource[];
}

export interface EnvContractKey {
	class: "config" | "secret";
	delivery?: "binding" | "command" | "env" | "file";
	name: string;
	optional_by?: string[];
	required_by: string[];
	templates?: string[];
}

export interface EnvContract {
	consumers: EnvContractConsumer[];
	forbidden_values?: Record<string, string[]>;
	keys: EnvContractKey[];
	owner: string;
	retired_names?: string[];
	schema_version: "campus_env_contract.v1";
}

interface EnvUse {
	class?: "config" | "secret";
	name: string;
	value?: string;
}

const envNamePattern = /^[A-Z][A-Z0-9_]*$/u;
const ignoredDirectories = new Set([
	".git",
	".pytest_cache",
	".turbo",
	".venv",
	".worktrees",
	".wrangler",
	".wrangler-home",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"target",
	"vendor",
]);

export function discoverEnvContracts(
	root = repoPath("."),
): Array<{ contract: EnvContract; path: string }> {
	const schema = JSON.parse(
		readFileSync(repoPath("packages/contracts/schemas/env-contract.v1.schema.json"), "utf8"),
	) as object;
	const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
	return walk(root, (path) => basename(path) === "env.contract.json").map((path) => {
		const payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!validate(payload)) {
			const first = validate.errors?.[0];
			throw new Error(
				`${relative(root, path)} failed env contract validation at ${first?.instancePath || "/"}: ${first?.message ?? "unknown error"}`,
			);
		}
		return { contract: payload as EnvContract, path };
	});
}

export function checkEnvContracts(root = repoPath(".")): void {
	const discovered = discoverEnvContracts(root);
	if (discovered.length === 0) {
		throw new Error("no env.contract.json files discovered");
	}
	const owners = new Map<string, string>();
	const templateOwners = new Map<string, string>();
	const keyClasses = new Map<string, { class: EnvContractKey["class"]; path: string }>();
	const activeNames = new Set(
		discovered.flatMap(({ contract }) => contract.keys.map((key) => key.name)),
	);
	const retiredNames = new Set(discovered.flatMap(({ contract }) => contract.retired_names ?? []));
	for (const retired of retiredNames) {
		if (activeNames.has(retired)) {
			throw new Error(`retired environment name is still active: ${retired}`);
		}
	}

	for (const { contract, path } of discovered) {
		const relativeContractPath = relativePath(root, path);
		const previousOwner = owners.get(contract.owner);
		if (previousOwner) {
			throw new Error(
				`duplicate env contract owner ${contract.owner}: ${previousOwner}, ${relativeContractPath}`,
			);
		}
		owners.set(contract.owner, relativeContractPath);
		const consumers = new Set(contract.consumers.map((consumer) => consumer.id));
		if (consumers.size !== contract.consumers.length) {
			throw new Error(`${relativeContractPath} contains duplicate consumer ids`);
		}
		for (const consumer of contract.consumers) {
			if ((consumer.sources?.length ?? 0) === 0 && (consumer.doctor_surfaces?.length ?? 0) === 0) {
				throw new Error(
					`${relativeContractPath} consumer ${consumer.id} has no executable source or doctor surface`,
				);
			}
		}
		const keys = new Set<string>();
		for (const key of contract.keys) {
			if (keys.has(key.name)) {
				throw new Error(`${relativeContractPath} contains duplicate key ${key.name}`);
			}
			keys.add(key.name);
			const previousClass = keyClasses.get(key.name);
			if (previousClass && previousClass.class !== key.class) {
				throw new Error(
					`${key.name} is ${previousClass.class} in ${previousClass.path}, but ${key.class} in ${relativeContractPath}`,
				);
			}
			keyClasses.set(key.name, { class: key.class, path: relativeContractPath });
			for (const consumer of [...key.required_by, ...(key.optional_by ?? [])]) {
				if (!consumers.has(consumer)) {
					throw new Error(
						`${relativeContractPath} key ${key.name} references unknown consumer ${consumer}`,
					);
				}
			}
			for (const template of key.templates ?? []) {
				const previous = templateOwners.get(template);
				if (previous && previous !== relativeContractPath) {
					throw new Error(
						`template ${template} is owned by both ${previous} and ${relativeContractPath}`,
					);
				}
				templateOwners.set(template, relativeContractPath);
			}
		}
		for (const forbiddenName of Object.keys(contract.forbidden_values ?? {})) {
			if (!keys.has(forbiddenName)) {
				throw new Error(
					`${relativeContractPath} defines forbidden values for unknown key ${forbiddenName}`,
				);
			}
		}
		for (const consumer of contract.consumers) {
			checkConsumerSources({
				activeNames,
				consumer,
				contract,
				contractPath: relativeContractPath,
				retiredNames,
				root,
			});
		}
	}

	const templates = walk(root, isEnvTemplate).map((path) => relativePath(root, path));
	for (const template of templates) {
		if (!templateOwners.has(template)) {
			throw new Error(`environment template has no owner contract: ${template}`);
		}
		const owner = discovered.find(({ contract }) =>
			contract.keys.some((key) => key.templates?.includes(template)),
		);
		if (!owner) {
			throw new Error(`environment template owner contract cannot be resolved: ${template}`);
		}
		const declaredKeys = new Set(
			owner.contract.keys.filter((key) => key.templates?.includes(template)).map((key) => key.name),
		);
		const values = parseEnv(readFileSync(resolve(root, template), "utf8"));
		const actualKeys = Object.keys(values).sort();
		for (const key of actualKeys) {
			if (retiredNames.has(key)) {
				throw new Error(`${template} still uses retired environment name ${key}`);
			}
			if (!declaredKeys.has(key)) {
				throw new Error(`${template} key ${key} is not declared by its owner contract`);
			}
			assertValueAllowed(owner.contract, key, values[key], template);
		}
		for (const key of declaredKeys) {
			if (!actualKeys.includes(key)) {
				throw new Error(`${template} declares no value for contracted key ${key}`);
			}
		}
	}
}

function checkConsumerSources(input: {
	activeNames: Set<string>;
	consumer: EnvContractConsumer;
	contract: EnvContract;
	contractPath: string;
	retiredNames: Set<string>;
	root: string;
}): void {
	const declared = new Map(
		input.contract.keys
			.filter(
				(key) =>
					key.required_by.includes(input.consumer.id) ||
					(key.optional_by?.includes(input.consumer.id) ?? false),
			)
			.map((key) => [key.name, key]),
	);
	for (const source of input.consumer.sources ?? []) {
		const ignored = new Set(source.ignore ?? []);
		const rejected = new Set(source.rejects ?? []);
		for (const name of ignored) {
			if (input.retiredNames.has(name)) {
				throw new Error(
					`${input.contractPath} source ${source.path} cannot ignore retired name ${name}`,
				);
			}
			if (!input.activeNames.has(name)) {
				throw new Error(
					`${input.contractPath} source ${source.path} cannot ignore uncontracted name ${name}`,
				);
			}
		}
		for (const name of rejected) {
			if (!input.retiredNames.has(name)) {
				throw new Error(
					`${input.contractPath} source ${source.path} rejects non-retired name ${name}`,
				);
			}
		}
		const uses = collectSourceUses(input.root, source);
		const observed = new Set(uses.map((use) => use.name));
		for (const name of ignored) {
			if (!observed.has(name)) {
				throw new Error(
					`${input.contractPath} source ${source.path} does not use ignored name ${name}`,
				);
			}
		}
		for (const name of rejected) {
			if (!observed.has(name)) {
				throw new Error(
					`${input.contractPath} source ${source.path} does not reject declared name ${name}`,
				);
			}
		}
		for (const use of uses) {
			if (ignored.has(use.name)) {
				continue;
			}
			if (rejected.has(use.name)) {
				continue;
			}
			if (input.retiredNames.has(use.name)) {
				throw new Error(`${source.path} still consumes retired environment name ${use.name}`);
			}
			const key = declared.get(use.name);
			if (!key) {
				throw new Error(
					`${source.path} consumer ${input.contract.owner}/${input.consumer.id} uses undeclared environment name ${use.name}`,
				);
			}
			if (use.class && use.class !== key.class) {
				throw new Error(
					`${source.path} delivers ${use.name} as ${use.class}, but ${input.contract.owner} declares it as ${key.class}`,
				);
			}
			assertValueAllowed(input.contract, use.name, use.value, source.path);
		}
	}
}

function collectSourceUses(root: string, source: EnvContractSource): EnvUse[] {
	const path = resolve(root, source.path);
	if (!existsSync(path)) {
		throw new Error(`environment contract source does not exist: ${source.path}`);
	}
	switch (source.kind) {
		case "typescript":
			return sourceFiles(
				path,
				new Set([".cjs", ".cts", ".js", ".mjs", ".mts", ".ts", ".tsx"]),
			).flatMap(collectTypeScriptUses);
		case "go":
			return sourceFiles(path, new Set([".go"])).flatMap(collectGoUses);
		case "wrangler":
			return collectWranglerUses(path, source.environment);
		case "kubernetes":
			return collectKubernetesUses(path, source.resources);
		case "workflow":
			return collectWorkflowUses(path, source.jobs);
		case "compose":
			return collectComposeUses(path, source.services);
		case "otel":
			return collectOtelUses(path);
		default: {
			const unsupportedKind: never = source.kind;
			throw new Error(`unsupported environment contract source kind: ${unsupportedKind}`);
		}
	}
}

function collectTypeScriptUses(path: string): EnvUse[] {
	const source = readFileSync(path, "utf8");
	const scriptKind = extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
	const names = new Set<string>();
	const addName = (value: string | undefined) => {
		if (value && envNamePattern.test(value)) {
			names.add(value);
		}
	};
	const visit = (node: ts.Node): void => {
		if (ts.isPropertyAccessExpression(node) && isEnvCarrier(node.expression)) {
			addName(node.name.text);
		}
		if (ts.isElementAccessExpression(node) && isEnvCarrier(node.expression)) {
			const argument = node.argumentExpression;
			if (
				argument &&
				(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
			) {
				addName(argument.text);
			}
		}
		if (ts.isCallExpression(node) && /env$/iu.test(callName(node.expression))) {
			for (const argument of node.arguments) {
				if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
					addName(argument.text);
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return [...names].sort().map((name) => ({ name }));
}

function isEnvCarrier(node: ts.Expression): boolean {
	if (ts.isIdentifier(node)) {
		return node.text === "env";
	}
	if (!ts.isPropertyAccessExpression(node) || node.name.text !== "env") {
		return false;
	}
	return true;
}

function callName(node: ts.Expression): string {
	if (ts.isIdentifier(node)) {
		return node.text;
	}
	if (ts.isPropertyAccessExpression(node)) {
		return node.name.text;
	}
	return "";
}

function collectGoUses(path: string): EnvUse[] {
	const source = readFileSync(path, "utf8");
	const names = new Set<string>();
	for (const pattern of [
		/\benv:"([A-Z][A-Z0-9_]*)"/gu,
		/\b(?:Getenv|LookupEnv|readBoolStrict|readStringList)\(\s*"([A-Z][A-Z0-9_]*)"/gu,
	]) {
		for (const match of source.matchAll(pattern)) {
			if (match[1]) {
				names.add(match[1]);
			}
		}
	}
	return [...names].sort().map((name) => ({ name }));
}

function collectWranglerUses(path: string, environment?: string): EnvUse[] {
	const config = parseToml(readFileSync(path, "utf8")) as Record<string, unknown>;
	const target = environment ? asRecord(asRecord(config.env)?.[environment]) : config;
	if (!target) {
		throw new Error(`${path} has no Wrangler environment ${environment}`);
	}
	const uses: EnvUse[] = [];
	for (const [name, value] of Object.entries(asRecord(target.vars) ?? {})) {
		if (envNamePattern.test(name)) {
			uses.push({ class: "config", name, value: String(value) });
		}
	}
	const requiredSecrets = asRecord(target.secrets)?.required;
	if (Array.isArray(requiredSecrets)) {
		for (const name of requiredSecrets) {
			if (typeof name === "string" && envNamePattern.test(name)) {
				uses.push({ class: "secret", name });
			}
		}
	}
	visitRecords(target, (record) => {
		const binding = record.binding;
		if (typeof binding === "string" && envNamePattern.test(binding)) {
			uses.push({ class: "config", name: binding });
		}
	});
	return uses;
}

function collectKubernetesUses(path: string, resourceNames?: string[]): EnvUse[] {
	const documents = YAML.parseAllDocuments(readFileSync(path, "utf8"));
	const requested = new Set(resourceNames ?? []);
	const found = new Set<string>();
	const uses: EnvUse[] = [];
	for (const document of documents) {
		if (document.errors.length > 0) {
			throw document.errors[0];
		}
		const resource = asRecord(document.toJSON() as unknown);
		if (!resource) {
			continue;
		}
		const resourceName = String(asRecord(resource.metadata)?.name ?? "");
		if (requested.size > 0 && !requested.has(resourceName)) {
			continue;
		}
		if (resourceName) {
			found.add(resourceName);
		}
		if (resource.kind === "ConfigMap") {
			for (const [name, value] of Object.entries(asRecord(resource.data) ?? {})) {
				if (envNamePattern.test(name)) {
					uses.push({ class: "config", name, value: String(value) });
				}
			}
		}
		visitRecords(resource, (record) => {
			for (const containerField of ["containers", "initContainers"]) {
				const containers = record[containerField];
				if (!Array.isArray(containers)) {
					continue;
				}
				for (const container of containers) {
					collectContainerEnv(path, container, uses);
				}
			}
		});
	}
	for (const name of requested) {
		if (!found.has(name)) {
			throw new Error(`${path} has no Kubernetes resource ${name}`);
		}
	}
	return uses;
}

function collectContainerEnv(path: string, value: unknown, uses: EnvUse[]): void {
	const container = asRecord(value);
	if (!container) {
		return;
	}
	for (const envFrom of Array.isArray(container.envFrom) ? container.envFrom : []) {
		if (asRecord(envFrom)?.secretRef) {
			throw new Error(`${path} uses forbidden envFrom.secretRef`);
		}
	}
	for (const raw of Array.isArray(container.env) ? container.env : []) {
		const item = asRecord(raw);
		const name = typeof item?.name === "string" ? item.name : "";
		if (!envNamePattern.test(name)) {
			continue;
		}
		const valueFrom = asRecord(item?.valueFrom);
		const classification = valueFrom?.secretKeyRef ? "secret" : "config";
		uses.push({
			class: classification,
			name,
			value: typeof item?.value === "string" ? item.value : undefined,
		});
	}
}

function collectWorkflowUses(path: string, jobNames?: string[]): EnvUse[] {
	const workflow = YAML.parse(readFileSync(path, "utf8")) as unknown;
	const root = asRecord(workflow);
	const jobs = asRecord(root?.jobs) ?? {};
	const requested = jobNames ?? Object.keys(jobs);
	const uses: EnvUse[] = [];
	collectWorkflowEnv(root?.env, uses);
	for (const name of requested) {
		const job = asRecord(jobs[name]);
		if (!job) {
			throw new Error(`${path} has no workflow job ${name}`);
		}
		collectWorkflowEnv(job.env, uses);
		for (const step of Array.isArray(job.steps) ? job.steps : []) {
			collectWorkflowEnv(asRecord(step)?.env, uses);
		}
		visitValues(job, (value) => {
			for (const match of value.matchAll(/\b(vars|secrets)\.([A-Z][A-Z0-9_]*)/gu)) {
				if (match[2]) {
					uses.push({ class: match[1] === "secrets" ? "secret" : "config", name: match[2] });
				}
			}
		});
	}
	return uses;
}

function collectWorkflowEnv(value: unknown, uses: EnvUse[]): void {
	for (const [name, raw] of Object.entries(asRecord(value) ?? {})) {
		if (!envNamePattern.test(name)) {
			continue;
		}
		const rendered = String(raw ?? "");
		uses.push({
			class: /\bsecrets\./u.test(rendered) ? "secret" : "config",
			name,
			value: rendered,
		});
	}
}

function collectComposeUses(path: string, serviceNames?: string[]): EnvUse[] {
	const compose = YAML.parse(readFileSync(path, "utf8")) as unknown;
	const services = asRecord(asRecord(compose)?.services) ?? {};
	const requested = serviceNames ?? Object.keys(services);
	const uses: EnvUse[] = [];
	for (const name of requested) {
		const service = services[name];
		if (!service) {
			throw new Error(`${path} has no Compose service ${name}`);
		}
		visitValues(service, (value) => {
			for (const match of value.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::[-?]([^}]*))?\}/gu)) {
				if (match[1]) {
					uses.push({ name: match[1], value: match[2] });
				}
			}
		});
	}
	return uses;
}

function collectOtelUses(path: string): EnvUse[] {
	const uses: EnvUse[] = [];
	for (const match of readFileSync(path, "utf8").matchAll(/\$\{env:([A-Z][A-Z0-9_]*)\}/gu)) {
		if (match[1]) {
			uses.push({ name: match[1] });
		}
	}
	return uses;
}

function assertValueAllowed(
	contract: EnvContract,
	name: string,
	value: string | undefined,
	source: string,
): void {
	if (value === undefined) {
		return;
	}
	if ((contract.forbidden_values?.[name] ?? []).includes(value.trim())) {
		throw new Error(`${source} assigns forbidden value ${JSON.stringify(value.trim())} to ${name}`);
	}
}

function sourceFiles(path: string, extensions: Set<string>): string[] {
	if (statSync(path).isFile()) {
		return extensions.has(extname(path)) ? [path] : [];
	}
	return walk(path, (candidate) => extensions.has(extname(candidate)));
}

function visitRecords(value: unknown, callback: (record: Record<string, unknown>) => void): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			visitRecords(item, callback);
		}
		return;
	}
	const record = asRecord(value);
	if (!record) {
		return;
	}
	callback(record);
	for (const child of Object.values(record)) {
		visitRecords(child, callback);
	}
}

function visitValues(value: unknown, callback: (value: string) => void): void {
	if (typeof value === "string") {
		callback(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			visitValues(item, callback);
		}
		return;
	}
	const record = asRecord(value);
	if (record) {
		for (const child of Object.values(record)) {
			visitValues(child, callback);
		}
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function walk(root: string, predicate: (path: string) => boolean): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!ignoredDirectories.has(entry.name)) {
				results.push(...walk(join(root, entry.name), predicate));
			}
		} else if (entry.isFile()) {
			const path = join(root, entry.name);
			if (predicate(path)) {
				results.push(path);
			}
		}
	}
	return results.sort();
}

function isEnvTemplate(path: string): boolean {
	const name = basename(path);
	return name === ".env.example" || name === ".dev.vars.example" || name.endsWith(".env.example");
}

function relativePath(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}
