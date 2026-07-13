import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repoPath } from "./common.ts";

const defaultAlertsPath = repoPath("configs/runtime/observability-alerts.v1.json");

const axiomDatasetBySignal: Record<string, string> = {
	missing_trace_rate: "campus-agent-runtime-metrics",
	request_error_rate: "campus-agent-runtime-metrics",
	stage_latency_p95: "campus-agent-runtime-metrics",
	telemetry_export_failure: "campus-agent-runtime-metrics",
};

const metricBySignal: Record<string, string> = {
	missing_trace_rate: "campus.app_api.trace_missing_ratio",
	request_error_rate: "campus.app_api.request_error_ratio",
	stage_latency_p95: "campus.app_api.stage_duration_ms",
	telemetry_export_failure: "campus.telemetry.export_failures",
};

export interface AxiomMonitorMaterialization {
	monitors: AxiomMonitorSpec[];
	schema_version: "axiom-monitor-materialization-v1";
	source_alert_version: string;
}

export interface AxiomMonitorSpec {
	dataset: string;
	description: string;
	evaluation_window: string;
	id: string;
	query: string;
	runbook_anchor: string;
	severity: string;
	threshold: {
		operator: string;
		unit: string;
		value: number;
	};
}

export function materializeAlertFile(path: string): AxiomMonitorMaterialization {
	const artifact = JSON.parse(readFileSync(path, "utf8")) as unknown;
	return materializeAlertArtifact(artifact);
}

export function materializeAlertArtifact(artifact: unknown): AxiomMonitorMaterialization {
	if (!isRecord(artifact)) {
		throw new Error("observability alerts artifact must be an object");
	}
	const rules = artifact.rules;
	if (!Array.isArray(rules)) {
		throw new Error("observability alerts artifact rules must be a list");
	}

	return {
		schema_version: "axiom-monitor-materialization-v1",
		source_alert_version: requiredString(artifact, "alert_version"),
		monitors: rules
			.filter((rule): rule is Record<string, unknown> => isRecord(rule) && rule.enabled === true)
			.map(materializeRule),
	};
}

function materializeRule(rule: Record<string, unknown>): AxiomMonitorSpec {
	const signal = requiredString(rule, "signal");
	if (!(signal in metricBySignal)) {
		throw new Error(`unsupported alert signal: ${signal}`);
	}
	const threshold = requiredObject(rule, "threshold");
	const stageField = typeof rule.stage_field === "string" ? rule.stage_field : null;
	return {
		id: requiredString(rule, "id"),
		dataset: axiomDatasetBySignal[signal] ?? "campus-agent-runtime-metrics",
		description: `${signal} ${threshold.operator} ${threshold.value} ${threshold.unit}`,
		evaluation_window: requiredString(rule, "window"),
		query: queryForRule(signal, stageField),
		runbook_anchor: requiredString(rule, "runbook_anchor"),
		severity: requiredString(rule, "severity"),
		threshold: {
			operator: requiredString(threshold, "operator"),
			unit: requiredString(threshold, "unit"),
			value: requiredNumber(threshold, "value"),
		},
	};
}

function queryForRule(signal: string, stageField: string | null): string {
	const metric = metricBySignal[signal];
	if (!metric) {
		throw new Error(`unsupported alert signal: ${signal}`);
	}
	if (signal === "stage_latency_p95") {
		if (!stageField) {
			throw new Error("stage_latency_p95 requires stage_field");
		}
		return `['${metric}']| where ['stage_field'] == '${stageField}'| summarize value = percentile(['value'], 95)`;
	}
	return `['${metric}']| summarize value = max(['value'])`;
}

function requiredObject(source: Record<string, unknown>, key: string): Record<string, unknown> {
	const value = source[key];
	if (!isRecord(value)) {
		throw new Error(`${key} must be an object`);
	}
	return value;
}

function requiredString(source: Record<string, unknown>, key: string): string {
	const value = source[key];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${key} must be a non-empty string`);
	}
	return value;
}

function requiredNumber(source: Record<string, unknown>, key: string): number {
	const value = source[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${key} must be a number`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArgs(argv: string[]): { alertsPath: string; json: boolean; selfTest: boolean } {
	let alertsPath = defaultAlertsPath;
	let json = false;
	let selfTest = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--self-test") {
			selfTest = true;
			continue;
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--alerts") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("--alerts requires a value");
			}
			alertsPath = value;
			index += 1;
			continue;
		}
		throw new Error(`unsupported argument: ${arg}`);
	}
	return { alertsPath, json, selfTest };
}

function runSelfTest(): number {
	const result = materializeAlertArtifact({
		alert_version: "observability-alerts-test",
		rules: [
			{
				id: "stage.stream_ttft.p95.warn",
				signal: "stage_latency_p95",
				severity: "ticket",
				window: "15m",
				stage_field: "stream.browser_ttft_ms",
				threshold: { operator: "gte", value: 2500, unit: "ms" },
				runbook_anchor: "#stage-latency",
				enabled: true,
			},
			{
				id: "requests.error_rate.page",
				signal: "request_error_rate",
				severity: "page",
				window: "15m",
				threshold: { operator: "gte", value: 0.02, unit: "ratio" },
				runbook_anchor: "#request-errors",
				enabled: true,
			},
			{
				id: "disabled.rule",
				signal: "telemetry_export_failure",
				severity: "ticket",
				window: "15m",
				threshold: { operator: "gte", value: 1, unit: "count" },
				runbook_anchor: "#telemetry-export",
				enabled: false,
			},
		],
	});
	expect(result.schema_version === "axiom-monitor-materialization-v1", "schema mismatch");
	expect(result.source_alert_version === "observability-alerts-test", "version mismatch");
	expect(result.monitors.length === 2, "enabled monitor count mismatch");
	expect(result.monitors[0]?.dataset === "campus-agent-runtime-metrics", "dataset mismatch");
	expect(
		result.monitors[0]?.query.includes("campus.app_api.stage_duration_ms"),
		"stage metric missing",
	);
	expect(result.monitors[0]?.query.includes("stream.browser_ttft_ms"), "stage field missing");
	expect(result.monitors[0]?.query.includes("percentile"), "percentile query missing");
	expect(result.monitors[1]?.severity === "page", "severity mismatch");
	expect(
		result.monitors[1]?.query.includes("campus.app_api.request_error_ratio") ?? false,
		"request metric missing",
	);
	expectThrows(
		() =>
			materializeAlertArtifact({
				alert_version: "observability-alerts-test",
				rules: [
					{
						id: "stage.invalid",
						signal: "stage_latency_p95",
						severity: "ticket",
						window: "15m",
						threshold: { operator: "gte", value: 2500, unit: "ms" },
						runbook_anchor: "#stage-latency",
						enabled: true,
					},
				],
			}),
		"requires stage_field",
	);
	console.log("materialize-observability-alerts self-test passed.");
	return 0;
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectThrows(callback: () => void, messageFragment: string): void {
	try {
		callback();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes(messageFragment)) {
			return;
		}
		throw new Error(`expected error containing ${messageFragment}, got ${message}`);
	}
	throw new Error(`expected error containing ${messageFragment}`);
}

async function main(argv: string[]): Promise<number> {
	const args = parseArgs(argv);
	if (args.selfTest) {
		return runSelfTest();
	}
	const result = materializeAlertFile(resolve(args.alertsPath));
	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(JSON.stringify(result));
	}
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
