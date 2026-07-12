import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repoPath } from "./common.ts";
import { generateToolExecutionContracts } from "./tool-execution-generate.ts";

const openApiPath = "docs/contracts/schemas/tool-execution.openapi.yaml";
const generatedTsPath = "apps/app-api/src/modules/integration/generated/tool-execution-contract.ts";
const generatedGoPath = "apps/execution-control/internal/contracts/tool_execution_contract.go";

export function runToolExecutionSelfTest(): void {
	checkOpenApiMetadata();
	checkWorkflowTraceSummary();
	checkRetiredRuntimeDecisions();
	checkExecutionResponseDiagnostics();
	checkGeneratedArtifacts();
	checkFixtureMatrix();
	generateToolExecutionContracts({ check: true });
}

function checkOpenApiMetadata(): void {
	const openapi = loadOpenApi();
	expect(openapi.openapi === "3.1.1", "OpenAPI version mismatch");
	expect(
		openapi.jsonSchemaDialect === "https://json-schema.org/draft/2020-12/schema",
		"dialect mismatch",
	);
	const meta = asRecord(openapi["x-campus-contract"], "x-campus-contract");
	expect(meta.execution_contract_version === "tool_execution_v1", "execution contract mismatch");
	expect(
		meta.response_contract === "execution_finalization_response_v2",
		"response contract mismatch",
	);
	expect(
		meta.workflow_trace_summary_version === "workflow-trace-summary-v5",
		"workflow trace version mismatch",
	);
	const policy = asRecord(meta.versioning_policy, "versioning_policy");
	expectEqualJson(
		new Set(Object.keys(policy)),
		new Set(["execution_contract_version", "response_contract", "workflow_trace_summary_version"]),
		"version policy keys",
	);
}

function checkWorkflowTraceSummary(): void {
	const summary = schema("WorkflowTraceSummary");
	const summaryProperties = properties(summary, "WorkflowTraceSummary");
	for (const field of [
		"workflow_mode",
		"selected_tool",
		"selected_tools",
		"first_decision_actor",
		"planning_outcome",
		"direct_vs_delegate_branch",
		"terminal_reason",
		"answer_artifact_kinds",
		"answer_artifact_refs",
		"trace_steps",
		"tool_call_summaries",
		"runtime_versions",
	]) {
		expectIncludes(summary.required, field, `${field} required`);
	}
	expectEqualJson(
		summaryProperties.workflow_mode,
		{ $ref: "#/components/schemas/WorkflowMode" },
		"workflow mode ref",
	);
	expectEqualJson(
		asRecord(summaryProperties.answer_artifact_kinds, "answer_artifact_kinds").items,
		{ $ref: "#/components/schemas/AnswerArtifactKind" },
		"answer artifact kind items",
	);
	expectEqualJson(
		schema("AnswerArtifactKind").enum,
		["agent_final_output"],
		"answer artifact kind enum",
	);
}

function checkRetiredRuntimeDecisions(): void {
	expectEqualJson(
		schema("WorkflowMode").enum,
		["terminal", "single_step", "multi_step"],
		"workflow modes",
	);
	const openapi = loadOpenApi();
	const schemaDefinitions = asRecord(asRecord(openapi.components, "components").schemas, "schemas");
	for (const retired of [
		"DelegateStatus",
		"StepOutputProjection",
		"StepOutputProjectionKind",
		"ToolRequest",
		"ToolResponse",
		"WorkflowContextProjection",
		"WorkflowToolContext",
		"RuntimeDecisions",
		"RuntimeDecisionSummary",
		"WorkflowPlan",
		"WorkflowPlanStep",
		"WorkflowPlanEdge",
		"ToolExecutionRequest",
		"ToolExecutionSubmitRequest",
	]) {
		expect(!(retired in schemaDefinitions), `${retired} must remain retired`);
	}
	expectEqualJson(
		schema("ToolID").enum,
		["knowledge_query", "knowledge_search", "transport_schedule_lookup"],
		"tool id enum",
	);
	expectEqualJson(
		schema("RequestedTool").enum,
		["knowledge_query", "transport_schedule_lookup"],
		"requested tool enum",
	);
	const payload = schema("ExecutionPayload");
	const payloadProperties = properties(payload, "ExecutionPayload");
	for (const retiredField of [
		"actor",
		"effective_tool",
		"requested_scope",
		"runtime_decisions",
		"task_queue",
	]) {
		expect(!(retiredField in payloadProperties), `${retiredField} must not be accepted`);
	}
	for (const requiredField of [
		"conversation_id",
		"context",
		"request_id",
		"trace",
		"version_query",
	]) {
		expectIncludes(payload.required, requiredField, `${requiredField} required`);
	}
	const runCreateProperties = properties(
		schema("ExecutionRunCreateRequest"),
		"ExecutionRunCreateRequest",
	);
	for (const callerRoutingField of ["requested_tool", "selected_tool", "task_queue"]) {
		expect(
			!(callerRoutingField in runCreateProperties),
			`${callerRoutingField} must not be caller-owned`,
		);
	}
	expectEqualJson(
		runCreateProperties.metadata,
		{ $ref: "#/components/schemas/ExecutionRunMetadata" },
		"run metadata ref",
	);
	expectEqualJson(
		schema("ExecutionRequestContext").not,
		{ required: ["profile_memory"] },
		"profile memory ban",
	);
}

function checkExecutionResponseDiagnostics(): void {
	const response = schema("ExecutionFinalizationResponse");
	const responseProperties = properties(response, "ExecutionFinalizationResponse");
	expectIncludes(response.required, "resolved_scope", "resolved scope required");
	expectIncludes(response.required, "session_update", "session update required");
	expectEqualJson(
		properties(schema("SessionUpdateSlot"), "SessionUpdateSlot").name,
		{
			enum: ["curriculum_program", "curriculum_program_family", "curriculum_semester"],
		},
		"session update slot names",
	);
	expectEqualJson(
		asRecord(responseProperties.stage_timing, "stage_timing").oneOf,
		[{ $ref: "#/components/schemas/StageTiming" }, { type: "null" }],
		"stage timing nullable ref",
	);
	const stageTiming = schema("StageTiming");
	const stageTimingProperties = properties(stageTiming, "StageTiming");
	expect(stageTiming.additionalProperties === false, "StageTiming must be closed");
	expectEqualJson(
		new Set(Object.keys(stageTimingProperties)),
		new Set([
			"request.total_ms",
			"stream.browser_ttft_ms",
			"execution.admission_ms",
			"memory.recall_ms",
			"agent.primary_ms",
			"agent.runtime_ms",
			"agent.first_delta_ms",
			"tool.total_ms",
			"tool.transport_schedule_lookup_ms",
			"knowledge.search_ms",
			"finalization.write_ms",
			"projection.closeout_ms",
		]),
		"stage timing fields",
	);
	expectIncludes(schema("ExecutionStatus").enum, "cancelled", "cancelled status");
}

function checkGeneratedArtifacts(): void {
	const tsContract = readFileSync(repoPath(generatedTsPath), "utf8");
	const goContract = readFileSync(repoPath(generatedGoPath), "utf8");
	for (const source of [tsContract, goContract]) {
		expect(
			source.includes("AUTO-GENERATED FROM tool-execution.openapi.yaml"),
			"generated marker missing",
		);
	}
	expect(
		tsContract.includes("interface ToolExecutionWorkflowTraceSummaryWire"),
		"TS workflow summary missing",
	);
	for (const requiredType of [
		"interface TraceContextWire",
		"interface VersionQueryWire",
		"interface ExecutionPayloadWire",
		"interface ExecutionRunCreateRequestWire",
		"interface SessionUpdateWire",
	]) {
		expect(tsContract.includes(requiredType), `TS generated contract missing ${requiredType}`);
	}
	expect(
		tsContract.includes("export type StageTimingWire = Partial<Record<StageTimingField, number>>"),
		"TS stage timing missing",
	);
	expect(
		goContract.includes("type WorkflowTraceSummaryWire struct"),
		"Go workflow summary missing",
	);
	expect(
		goContract.includes("type StageTimingWire map[StageTimingField]float64"),
		"Go stage timing missing",
	);
	for (const requiredSymbol of [
		"type ExecutionPayloadWire struct",
		"type ExecutionRunCreateRequestWire struct",
		"func DecodeExecutionPayloadWireJSON",
		"func DecodeExecutionRunCreateRequestWireJSON",
		"func (wire VersionQueryWire) Validate() error",
		"func (wire SessionUpdateWire) Validate() error",
	]) {
		expect(goContract.includes(requiredSymbol), `Go generated contract missing ${requiredSymbol}`);
	}
	for (const retired of [
		"DelegateStatus",
		"StepOutputProjection",
		"ToolRequestWire",
		"ToolResponseWire",
		"WorkflowToolContext",
		"RuntimeDecisionsWire",
		"WorkflowPlanWire",
		"ToolExecutionRequestWire",
		"RequestedToolPlaceLookup",
	]) {
		expect(!tsContract.includes(retired), `TS generated contract leaked ${retired}`);
		expect(!goContract.includes(retired), `Go generated contract leaked ${retired}`);
	}
}

function checkFixtureMatrix(): void {
	const delegate = loadFixture("execution_payload.valid.json");
	expect(
		delegate.execution_contract_version === "tool_execution_v1",
		"delegate execution contract",
	);
	expect(
		delegate.response_contract === "execution_finalization_response_v2",
		"delegate response contract",
	);
	expect(!("runtime_decisions" in delegate), "delegate fixture leaked runtime_decisions");

	for (const fixtureName of [
		"execution_payload_extra_field.invalid.json",
		"execution_payload_invalid_enum.invalid.json",
		"execution_payload_invalid_version.invalid.json",
		"response_camel_case.invalid.json",
		"response_extra_field.invalid.json",
	]) {
		expect(Object.keys(loadFixture(fixtureName)).length > 0, `${fixtureName} missing`);
	}
	for (const [fixtureName, expectedStatus] of Object.entries({
		"response_cancelled_null_target.valid.json": "cancelled",
		"response_completed_delegate.valid.json": "completed",
		"response_error_execution_control_unavailable.valid.json": "error",
		"response_timeout.valid.json": "error",
	})) {
		const response = loadFixture(fixtureName);
		expect(response.status === expectedStatus, `${fixtureName} status mismatch`);
		expect(
			String(response.trace_id).startsWith("trace-contract-"),
			`${fixtureName} trace id mismatch`,
		);
	}
}

function schema(name: string): Record<string, unknown> {
	const openapi = loadOpenApi();
	return asRecord(
		asRecord(asRecord(openapi.components, "components").schemas, "schemas")[name],
		name,
	);
}

function loadOpenApi(): Record<string, unknown> {
	return asRecord(YAML.parse(readFileSync(repoPath(openApiPath), "utf8")), openApiPath);
}

function loadFixture(name: string): Record<string, unknown> {
	return readJson(`packages/contracts/fixtures/tool_execution_contract/${name}`);
}

function readJson(path: string): Record<string, unknown> {
	return asRecord(JSON.parse(readFileSync(repoPath(path), "utf8")) as unknown, path);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function properties(schemaValue: Record<string, unknown>, label: string): Record<string, unknown> {
	return asRecord(schemaValue.properties, `${label}.properties`);
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectIncludes(value: unknown, item: string, message: string): void {
	expect(arrayIncludes(value, item), message);
}

function arrayIncludes(value: unknown, item: string): boolean {
	return Array.isArray(value) && value.includes(item);
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	const normalize = (value: unknown): unknown =>
		value instanceof Set ? [...value].sort() : Array.isArray(value) ? value.map(normalize) : value;
	if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(expected))) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}
