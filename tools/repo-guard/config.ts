import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import type { RepoGuardIssue } from "./common.ts";

interface OfficialWebTarget {
	consumer_family: string;
	materialization_policy: string;
	optional_evidence: string[];
	owner_surface: string;
	required_evidence: string[];
	review_policy: string;
	selected_write_target: string;
	title_hints: string[];
	url_hints: string[];
}

interface OfficialWebConsumerFamily {
	consumer_family: string;
	materialization_policy: string;
	optional_evidence: string[];
	owner_surface: string;
	path_patterns: string[];
	required_evidence: string[];
	review_policy: string;
	selected_write_target: string;
	title_keywords: string[];
}

export function auditRepoConfigGuard(root: string): RepoGuardIssue[] {
	return [
		...auditOfficialWebTargetDenominator(root),
		...auditTraefikStagingValues(root),
		...auditRuntimeArtifactStatusLanguage(root),
	].sort((left, right) =>
		`${left.path}\0${left.message}`.localeCompare(`${right.path}\0${right.message}`),
	);
}

export function auditRuntimeArtifactStatusLanguage(root: string): RepoGuardIssue[] {
	const paths = [
		"configs/runtime/workflow-artifacts.v2.json",
		"packages/contracts/schemas/runtime-workflow-artifacts.v2.schema.json",
		"apps/execution-control/internal/runtimepolicy/artifact_registry.go",
		"apps/execution-control/internal/runtimepolicy/artifact_registry_test.go",
	];
	const forbidden = [
		{
			token: "planned_contract_gap",
			message:
				"runtime artifact support status must use closed_no_runtime, not planned gap wording",
		},
		{
			token: "future rollout",
			message: "runtime artifact notes must describe current support, not future rollout plans",
		},
	];
	const issues: RepoGuardIssue[] = [];
	for (const path of paths) {
		const absolutePath = join(root, path);
		if (!existsSync(absolutePath)) {
			continue;
		}
		const text = readFileSync(absolutePath, "utf8");
		for (const { token, message } of forbidden) {
			if (text.includes(token)) {
				issues.push({ path, message });
			}
		}
	}
	return issues;
}

function auditOfficialWebTargetDenominator(root: string): RepoGuardIssue[] {
	const path = "configs/sources/official_web/muc_public/consumer-denominator.json";
	const targetMapPath = "configs/sources/official_web/muc_public/target-source-map.json";
	const targetMap = readJson<{ targets: OfficialWebTarget[] }>(root, targetMapPath);
	const denominator = readJson<{ consumer_families: OfficialWebConsumerFamily[] }>(root, path);
	const issues: RepoGuardIssue[] = [];
	const targetsByFamily = new Map(
		targetMap.targets.map((target) => [target.consumer_family, target]),
	);
	const denominatorByFamily = new Map(
		denominator.consumer_families.map((family) => [family.consumer_family, family]),
	);
	expectSameSet(
		issues,
		path,
		[...denominatorByFamily.keys()],
		[...targetsByFamily.keys()],
		"consumer families must match target-source-map",
	);
	for (const [family, target] of targetsByFamily) {
		const denominatorFamily = denominatorByFamily.get(family);
		if (!denominatorFamily) {
			continue;
		}
		expectEqual(
			issues,
			path,
			denominatorFamily.owner_surface,
			target.owner_surface,
			`${family}.owner_surface must match target-source-map`,
		);
		expectEqual(
			issues,
			path,
			denominatorFamily.selected_write_target,
			target.selected_write_target,
			`${family}.selected_write_target must match target-source-map`,
		);
		expectEqual(
			issues,
			path,
			denominatorFamily.materialization_policy,
			target.materialization_policy,
			`${family}.materialization_policy must match target-source-map`,
		);
		expectEqual(
			issues,
			path,
			denominatorFamily.review_policy,
			target.review_policy,
			`${family}.review_policy must match target-source-map`,
		);
		expectSameSet(
			issues,
			path,
			denominatorFamily.required_evidence,
			target.required_evidence,
			`${family}.required_evidence must match target-source-map`,
		);
		expectSameSet(
			issues,
			path,
			denominatorFamily.optional_evidence,
			target.optional_evidence,
			`${family}.optional_evidence must match target-source-map`,
		);
		expectSameSet(
			issues,
			path,
			denominatorFamily.title_keywords,
			target.title_hints,
			`${family}.title_keywords must match target title_hints`,
		);
		expectSameSet(
			issues,
			path,
			denominatorFamily.path_patterns,
			target.url_hints,
			`${family}.path_patterns must match target url_hints`,
		);
	}
	const studentTarget = targetsByFamily.get("student_regulation_candidate");
	if (studentTarget) {
		expectEqual(
			issues,
			targetMapPath,
			studentTarget.owner_surface,
			"regulations/student_rules",
			"student_regulation_candidate owner_surface must be student rules",
		);
		expectEqual(
			issues,
			targetMapPath,
			studentTarget.selected_write_target,
			"regulations/student_rules",
			"student_regulation_candidate selected_write_target must be student rules",
		);
	}
	return issues;
}

function auditTraefikStagingValues(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const shadowPath = "infra/gitops/values/traefik/nc-arm-6c-shadow.yaml";
	const cutoverPath = "infra/gitops/values/traefik/nc-arm-6c-cutover.yaml";
	const shadow = readYamlRecord(root, shadowPath);
	const cutover = readYamlRecord(root, cutoverPath);
	expectTraefikCommon(issues, shadowPath, shadow);
	expectTraefikCommon(issues, cutoverPath, cutover);
	expectEqual(
		issues,
		shadowPath,
		getPath(shadow, ["ports", "web", "hostPort"]),
		18080,
		"shadow web hostPort must stay private",
	);
	expectEqual(
		issues,
		shadowPath,
		getPath(shadow, ["ports", "websecure", "hostPort"]),
		18443,
		"shadow websecure hostPort must stay private",
	);
	expectEqual(
		issues,
		cutoverPath,
		getPath(cutover, ["ports", "web", "hostPort"]),
		80,
		"cutover web hostPort must be public",
	);
	expectEqual(
		issues,
		cutoverPath,
		getPath(cutover, ["ports", "websecure", "hostPort"]),
		443,
		"cutover websecure hostPort must be public",
	);
	return issues;
}

function expectTraefikCommon(
	issues: RepoGuardIssue[],
	path: string,
	values: Record<string, unknown>,
): void {
	expectEqual(
		issues,
		path,
		getPath(values, ["ingressClass", "name"]),
		"traefik-staging",
		"ingressClass.name must be traefik-staging",
	);
	expectEqual(
		issues,
		path,
		getPath(values, ["ingressClass", "isDefaultClass"]),
		false,
		"ingressClass must not be default",
	);
	expectEqual(
		issues,
		path,
		getPath(values, ["providers", "kubernetesIngress", "ingressClass"]),
		"traefik-staging",
		"kubernetesIngress ingressClass must be traefik-staging",
	);
	expectSameSet(
		issues,
		path,
		asStringArray(getPath(values, ["providers", "kubernetesIngress", "namespaces"])),
		["campus-agent-staging"],
		"kubernetesIngress namespaces must be campus-agent-staging only",
	);
	expectEqual(
		issues,
		path,
		getPath(values, ["providers", "kubernetesCRD", "enabled"]),
		false,
		"kubernetesCRD must be disabled",
	);
	expectEqual(
		issues,
		path,
		getPath(values, ["providers", "kubernetesGateway", "enabled"]),
		false,
		"kubernetesGateway must be disabled",
	);
	expectEqual(
		issues,
		path,
		getPath(values, ["service", "enabled"]),
		false,
		"service must be disabled",
	);
}

function readJson<T>(root: string, path: string): T {
	return JSON.parse(readFileSync(join(root, path), "utf8")) as T;
}

function readYamlRecord(root: string, path: string): Record<string, unknown> {
	const parsed = parseYaml(readFileSync(join(root, path), "utf8"));
	return isRecord(parsed) ? parsed : {};
}

function getPath(root: Record<string, unknown>, path: string[]): unknown {
	let current: unknown = root;
	for (const segment of path) {
		if (!isRecord(current)) {
			return;
		}
		current = current[segment];
	}
	return current;
}

function expectEqual(
	issues: RepoGuardIssue[],
	path: string,
	actual: unknown,
	expected: unknown,
	message: string,
): void {
	if (actual !== expected) {
		issues.push({
			path,
			message: `${message}: expected ${String(expected)}, got ${String(actual)}`,
		});
	}
}

function expectSameSet(
	issues: RepoGuardIssue[],
	path: string,
	actual: string[],
	expected: string[],
	message: string,
): void {
	const actualSorted = [...actual].sort();
	const expectedSorted = [...expected].sort();
	if (
		actualSorted.length !== expectedSorted.length ||
		actualSorted.some((item, index) => item !== expectedSorted[index])
	) {
		issues.push({
			path,
			message: `${message}: expected ${expectedSorted.join(", ")}, got ${actualSorted.join(", ")}`,
		});
	}
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
