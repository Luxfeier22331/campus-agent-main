import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repoPath } from "./common.ts";
import { generateToolExecutionContracts } from "./tool-execution-generate.ts";

const openApiPath = "docs/contracts/schemas/tool-execution.openapi.yaml";
const toolHandoffSchemaPath = "packages/contracts/schemas/tool-handoff.v1.schema.json";
const generatedTsPath = "apps/app-api/src/modules/integration/generated/tool-execution-contract.ts";
const generatedGoPath = "apps/execution-control/internal/contracts/tool_execution_contract.go";

export function runToolExecutionSelfTest(): void {
	checkOpenApiMetadata();
	checkWorkflowTraceSummary();
	checkProjectionSchemas();
	checkWorkflowContext();
	checkRuntimeDecisions();
	checkExecutionResponseDiagnostics();
	checkToolHandoffSchema();
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
		meta.runtime_decisions_schema_version === "tool-execution-runtime-decisions-v1",
		"runtime decisions version mismatch",
	);
	expect(
		meta.runtime_decision_summary_schema_version === "runtime-decision-summary-v1",
		"runtime decision summary version mismatch",
	);
	expect(
		meta.workflow_trace_summary_version === "workflow-trace-summary-v4",
		"workflow trace version mismatch",
	);
	const policy = asRecord(meta.versioning_policy, "versioning_policy");
	expectEqualJson(
		new Set(Object.keys(policy)),
		new Set([
			"execution_contract_version",
			"response_contract",
			"runtime_decisions_schema_version",
			"runtime_decision_summary_schema_version",
			"workflow_trace_summary_version",
		]),
		"version policy keys",
	);
}

function checkWorkflowTraceSummary(): void {
	const summary = schema("WorkflowTraceSummary");
	const summaryProperties = properties(summary, "WorkflowTraceSummary");
	expectIncludes(summary.required, "workflow_mode", "workflow_mode required");
	expectIncludes(summary.required, "handoff_chain", "handoff_chain required");
	expectIncludes(summary.required, "context_projections", "context projections required");
	expectIncludes(
		summary.required,
		"answer_artifact_projection_ids",
		"answer artifact ids required",
	);
	expectIncludes(summary.required, "answer_artifact_kinds", "answer artifact kinds required");
	expectEqualJson(
		summaryProperties.workflow_mode,
		{ $ref: "#/components/schemas/WorkflowMode" },
		"workflow mode ref",
	);
	expect(
		asRecord(summaryProperties.handoff_chain, "handoff_chain").type === "array",
		"handoff_chain array",
	);
	expectEqualJson(
		asRecord(summaryProperties.context_projections, "context_projections").items,
		{ $ref: "#/components/schemas/WorkflowContextProjection" },
		"context projection items",
	);
	expectIncludes(summary.required, "tool_invocations", "tool invocations required");
	expectEqualJson(
		asRecord(summaryProperties.tool_invocations, "tool_invocations").items,
		{ $ref: "#/components/schemas/ToolInvocation" },
		"tool invocation items",
	);
}

function checkProjectionSchemas(): void {
	const projection = schema("StepOutputProjection");
	const contextProjection = schema("WorkflowContextProjection");
	const projectionProperties = properties(projection, "StepOutputProjection");
	const contextProjectionProperties = properties(contextProjection, "WorkflowContextProjection");
	expectEqualJson(
		schema("StepOutputProjectionKind").enum,
		[
			"notice_context",
			"schedule_baseline",
			"place_context",
			"evidence_bundle",
			"grounding_verdict",
		],
		"projection kind enum",
	);
	for (const required of ["projection_id", "projection_kind", "content_hash", "safety"]) {
		expectIncludes(projection.required, required, `${required} required`);
	}
	expectEqualJson(
		projectionProperties.projection_kind,
		{ $ref: "#/components/schemas/StepOutputProjectionKind" },
		"step projection kind ref",
	);
	expectEqualJson(
		contextProjectionProperties.projection_kind,
		{ $ref: "#/components/schemas/StepOutputProjectionKind" },
		"context projection kind ref",
	);
}

function checkWorkflowContext(): void {
	const request = schema("ToolRequest");
	const workflowContext = schema("WorkflowToolContext");
	const requestProperties = properties(request, "ToolRequest");
	const workflowContextProperties = properties(workflowContext, "WorkflowToolContext");
	expectEqualJson(
		requestProperties.workflow_context,
		{ $ref: "#/components/schemas/WorkflowToolContext" },
		"workflow context ref",
	);
	for (const required of [
		"schema_version",
		"visibility",
		"workflow_run_ref",
		"step_id",
		"tool_id",
		"expected_output_artifacts",
		"projection_refs",
	]) {
		expectIncludes(workflowContext.required, required, `${required} required`);
	}
	expectEqualJson(
		workflowContextProperties.tool_id,
		{ $ref: "#/components/schemas/ToolID" },
		"tool id ref",
	);
	expectEqualJson(
		asRecord(workflowContextProperties.expected_output_artifacts, "expected_output_artifacts")
			.items,
		{ $ref: "#/components/schemas/StepOutputProjectionKind" },
		"expected artifacts items",
	);
	expectEqualJson(
		asRecord(workflowContextProperties.projection_refs, "projection_refs").items,
		{ $ref: "#/components/schemas/WorkflowContextProjection" },
		"projection refs items",
	);
}

function checkRuntimeDecisions(): void {
	expectEqualJson(
		schema("WorkflowMode").enum,
		["terminal", "single_step", "multi_step"],
		"workflow modes",
	);
	const runtimeDecisions = schema("RuntimeDecisions");
	const workflowPlan = schema("WorkflowPlan");
	const runtimeDecisionProperties = properties(runtimeDecisions, "RuntimeDecisions");
	const workflowPlanProperties = properties(workflowPlan, "WorkflowPlan");
	expectEqualJson(
		runtimeDecisionProperties.workflow_plan,
		{ $ref: "#/components/schemas/WorkflowPlan" },
		"workflow plan ref",
	);
	expect(
		asRecord(workflowPlanProperties.schema_version, "schema_version").const === "workflow-plan-v1",
		"workflow plan schema version",
	);
	expectIncludes(workflowPlan.required, "allowed_tools", "allowed tools required");
	expectIncludes(workflowPlan.required, "steps", "steps required");
	expectIncludes(workflowPlan.required, "semantic_retry_policy", "retry policy required");
	expectEqualJson(
		asRecord(workflowPlanProperties.allowed_tools, "allowed_tools").items,
		{ $ref: "#/components/schemas/ToolID" },
		"allowed tools items",
	);
	const request = schema("ToolExecutionRequest");
	const requestProperties = properties(request, "ToolExecutionRequest");
	expect(
		!arrayIncludes(request.required, "runtime_decisions"),
		"runtime_decisions must not be required",
	);
	expect(
		asRecord(requestProperties.runtime_decisions, "runtime_decisions").deprecated === true,
		"runtime_decisions should be deprecated",
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
			"tool.knowledge_query_ms",
			"tool.transport_schedule_lookup_ms",
			"tool.campus_notice_discover_ms",
			"rag.plan_ms",
			"rag.lookup_ms",
			"rag.rerank_ms",
			"rag.synthesis_ms",
			"rag.grounding_ms",
			"finalization.write_ms",
			"projection.closeout_ms",
		]),
		"stage timing fields",
	);
	const debugTrace = schema("DebugTraceRef");
	const debugTraceProperties = properties(debugTrace, "DebugTraceRef");
	expect(debugTrace.additionalProperties === false, "debug trace ref must be closed");
	expectEqualJson(debugTrace.required, ["sink", "trace_ref"], "debug trace required fields");
	expectEqualJson(
		asRecord(debugTraceProperties.sink, "sink").enum,
		["langfuse_otlp"],
		"debug trace sinks",
	);
	expectIncludes(schema("ExecutionStatus").enum, "cancelled", "cancelled status");
}

function checkToolHandoffSchema(): void {
	const schema = readJson(toolHandoffSchemaPath);
	expect(schema.$schema === "https://json-schema.org/draft/2020-12/schema", "tool handoff dialect");
	expect("ToolRequest" in asRecord(schema.$defs, "$defs"), "ToolRequest def missing");
	expect("ToolResponse" in asRecord(schema.$defs, "$defs"), "ToolResponse def missing");
	const serialized = JSON.stringify(schema);
	expect(!serialized.includes("runtime_decisions"), "tool handoff leaked runtime_decisions");
	expect(!serialized.includes("tool_execution_v1"), "tool handoff leaked execution wrapper");
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
	expect(
		tsContract.includes("export type StageTimingWire = Partial<Record<StageTimingField, number>>"),
		"TS stage timing missing",
	);
	expect(
		tsContract.includes('export const DEBUG_TRACE_SINKS = ["langfuse_otlp"] as const'),
		"TS debug sinks missing",
	);
	expect(
		goContract.includes("type WorkflowTraceSummaryWire struct"),
		"Go workflow summary missing",
	);
	expect(
		goContract.includes("type StageTimingWire map[StageTimingField]float64"),
		"Go stage timing missing",
	);
	expect(
		goContract.includes("func (wire DebugTraceRefWire) Validate() error"),
		"Go debug trace validation missing",
	);
}

function checkFixtureMatrix(): void {
	const delegate = loadFixture("tool_execution_delegate.valid.json");
	expect(
		delegate.execution_contract_version === "tool_execution_v1",
		"delegate execution contract",
	);
	expect(
		delegate.response_contract === "execution_finalization_response_v2",
		"delegate response contract",
	);
	const runtimeDecisions = asRecord(delegate.runtime_decisions, "runtime_decisions");
	expect(
		runtimeDecisions.schema_version === "tool-execution-runtime-decisions-v1",
		"runtime decisions schema",
	);
	const toolRequest = asRecord(
		asRecord(runtimeDecisions.handoff, "handoff").tool_request,
		"tool_request",
	);
	expect(toolRequest.tool === "knowledge_query", "tool request target");

	const workflowContext = {
		schema_version: "workflow-tool-context-v1",
		visibility: "tool_private",
		workflow_run_ref: "workflow:req-contract-001",
		step_id: "tool:knowledge_query:rag_request",
		tool_id: "knowledge_query",
		required_projection_kind: "notice_context",
		expected_output_artifacts: ["evidence_bundle", "grounding_verdict"],
		projection_refs: [
			{
				projection_id: "projection:notice_context:test",
				source_step_id: "tool:notice:campus_notice_get",
				projection_kind: "notice_context",
				content_hash: "sha256:test",
				safety: { max_chars: 1600, fields_present: ["title"] },
			},
		],
	};
	expect(
		!("raw_response" in workflowContext.projection_refs[0]),
		"projection ref leaked raw response",
	);
	expect(!("payload" in workflowContext.projection_refs[0]), "projection ref leaked payload");

	for (const fixtureName of [
		"tool_execution_extra_field.invalid.json",
		"tool_execution_invalid_enum.invalid.json",
		"tool_execution_invalid_version.invalid.json",
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
