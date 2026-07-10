import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseAllDocuments } from "yaml";

export interface RuntimeManifestIssue {
	path: string;
	message: string;
}

export type RuntimeDoc = Record<string, unknown>;
export type RuntimeIssues = RuntimeManifestIssue[];

export function readYamlDocs(root: string, path: string, issues: RuntimeIssues): RuntimeDoc[] {
	try {
		return parseAllDocuments(readFileSync(join(root, path), "utf8"))
			.map((doc) => doc.toJS())
			.filter(recordValue)
			.map((doc) => ({ ...doc, _sourcePath: path }));
	} catch (error) {
		issues.push({ path, message: messageForError(error) });
		return [];
	}
}

export function renderKustomizeDocs(
	root: string,
	path: string,
	issues: RuntimeIssues,
): RuntimeDoc[] {
	const result = spawnSync("kubectl", ["kustomize", path], { cwd: root, encoding: "utf8" });
	if (result.status !== 0) {
		issues.push({
			path,
			message: result.stderr.trim() || result.stdout.trim() || "kubectl kustomize failed",
		});
		return [];
	}
	return parseAllDocuments(result.stdout)
		.map((doc) => doc.toJS())
		.filter(recordValue)
		.map((doc) => ({ ...doc, _sourcePath: path }));
}

export function byKindName(docs: RuntimeDoc[], kind: string): Map<string, RuntimeDoc> {
	return new Map(docs.filter((doc) => doc.kind === kind).map((doc) => [resourceName(doc), doc]));
}

export function deploymentContainer(issues: RuntimeIssues, deployment: RuntimeDoc): RuntimeDoc {
	const containers = records(valueAt(deployment, ["spec", "template", "spec", "containers"]));
	if (containers.length !== 1) {
		issues.push({
			path: sourcePath(deployment),
			message: `${resourceName(deployment)} must have exactly one container`,
		});
	}
	return containers[0] ?? {};
}

export function envFromNames(issues: RuntimeIssues, deployment: RuntimeDoc): [string, string][] {
	return records(deploymentContainer(issues, deployment).envFrom).flatMap((entry) => {
		if (entry.configMapRef) {
			return [
				["configMapRef", String(valueAt(entry, ["configMapRef", "name"]))] as [string, string],
			];
		}
		if (entry.secretRef) {
			return [["secretRef", String(valueAt(entry, ["secretRef", "name"]))] as [string, string]];
		}
		return [];
	});
}

export function volumeNames(deployment: RuntimeDoc): string[] {
	return records(valueAt(deployment, ["spec", "template", "spec", "volumes"]))
		.map((volume) => String(volume.name))
		.sort();
}

export function volumeMounts(
	issues: RuntimeIssues,
	deployment: RuntimeDoc,
): Record<string, RuntimeDoc> {
	return Object.fromEntries(
		records(deploymentContainer(issues, deployment).volumeMounts)
			.filter((mount) => mount.name)
			.map((mount) => [String(mount.name), mount]),
	);
}

export function volume(deployment: RuntimeDoc, name: string): RuntimeDoc {
	return (
		records(valueAt(deployment, ["spec", "template", "spec", "volumes"])).find(
			(item) => item.name === name,
		) ?? {}
	);
}

export function surfaceIdentityValues(doc: RuntimeDoc): [string, string][] {
	const values: [string, string][] = [];
	const kind = String(doc.kind ?? "resource");
	const metadata = recordValue(doc.metadata) ?? {};
	const labels = recordValue(metadata.labels) ?? {};
	if (["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "ScaledObject"].includes(kind)) {
		values.push([`${kind}.metadata.name`, String(metadata.name ?? "")]);
	}
	for (const key of ["app.kubernetes.io/name", "app.kubernetes.io/component"]) {
		if (key in labels) {
			values.push([`${kind}.metadata.labels.${key}`, String(labels[key])]);
		}
	}
	const selector = recordAt(doc, ["spec", "selector"]) ?? {};
	for (const [key, value] of Object.entries(recordValue(selector.matchLabels) ?? selector)) {
		values.push([`${kind}.spec.selector.${key}`, String(value)]);
	}
	const scaleTarget = recordAt(doc, ["spec", "scaleTargetRef"]);
	if (scaleTarget?.name) {
		values.push([`${kind}.spec.scaleTargetRef.name`, String(scaleTarget.name)]);
	}
	const templateLabels = recordAt(doc, ["spec", "template", "metadata", "labels"]) ?? {};
	for (const key of ["app.kubernetes.io/name", "app.kubernetes.io/component"]) {
		if (key in templateLabels) {
			values.push([`${kind}.spec.template.metadata.labels.${key}`, String(templateLabels[key])]);
		}
	}
	for (const container of records(valueAt(doc, ["spec", "template", "spec", "containers"]))) {
		values.push([`${kind}.container.name`, String(container.name ?? "")]);
		values.push([`${kind}.container.image`, String(container.image ?? "")]);
		for (const command of arrayValue(container.command).map(String)) {
			if (command.startsWith("/usr/local/bin/")) {
				values.push([`${kind}.container.command`, basename(command)]);
			}
		}
	}
	return values;
}

export function valueAt(root: unknown, path: (number | string)[]): unknown {
	let current = root;
	for (const segment of path) {
		current =
			typeof segment === "number" ? arrayValue(current)[segment] : recordValue(current)?.[segment];
	}
	return current;
}

export function recordAt(root: unknown, path: (number | string)[]): RuntimeDoc | undefined {
	return recordValue(valueAt(root, path));
}

export function records(value: unknown): RuntimeDoc[] {
	return Array.isArray(value) ? value.filter(recordValue) : [];
}

export function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function recordValue(value: unknown): RuntimeDoc | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

export function resourceName(doc: RuntimeDoc | undefined): string {
	return String(recordValue(doc?.metadata)?.name ?? "");
}

export function sourcePath(doc: RuntimeDoc | undefined): string {
	return String(doc?._sourcePath ?? "runtime manifest");
}

export function expectIssue(
	issues: RuntimeIssues,
	path: string,
	condition: unknown,
	message: string,
): void {
	if (!condition) {
		issues.push({ path, message });
	}
}

export function expectEqual(
	issues: RuntimeIssues,
	path: string,
	actual: unknown,
	expected: unknown,
	label: string,
): void {
	if (!jsonEqual(actual, expected)) {
		issues.push({
			path,
			message: `${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
		});
	}
}

export function expectSameSet(
	issues: RuntimeIssues,
	path: string,
	actual: string[],
	expected: string[],
	label: string,
): void {
	expectEqual(issues, path, [...actual].sort(), [...expected].sort(), label);
}

export function expectContains(
	issues: RuntimeIssues,
	path: string,
	actual: string[],
	expected: string,
	label: string,
): void {
	if (!actual.includes(expected)) {
		issues.push({ path, message: `${label} must include ${expected}` });
	}
}

export function expectNotContains(
	issues: RuntimeIssues,
	path: string,
	actual: string[],
	forbidden: string,
	label: string,
): void {
	if (actual.includes(forbidden)) {
		issues.push({ path, message: `${label} must not include ${forbidden}` });
	}
}

export function expectText(
	issues: RuntimeIssues,
	path: string,
	text: string,
	expected: string,
	label: string,
): void {
	if (!text.includes(expected)) {
		issues.push({ path, message: `${label} must include ${expected}` });
	}
}

export function secretLike(key: string): boolean {
	return /(SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH_HEADER|AUTH_VALUE|DATABASE_URL|BEARER_TOKEN|TOKEN|SALT)/.test(
		key,
	);
}

export function messageForError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function jsonEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
}

function normalizeJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(normalizeJson);
	}
	const item = recordValue(value);
	if (!item) {
		return value;
	}
	return Object.fromEntries(
		Object.keys(item)
			.sort()
			.map((key) => [key, normalizeJson(item[key])]),
	);
}
