import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";
import { repoPath } from "./common.ts";
import { generateToolExecutionContracts } from "./tool-execution-generate.ts";

const openApiPath = "docs/contracts/schemas/tool-execution.openapi.yaml";
const generatedTsPath = "apps/app-api/src/modules/integration/generated/tool-execution-contract.ts";
const generatedGoPath = "apps/execution-control/internal/contracts/tool_execution_contract.go";

export function runToolExecutionSelfTest(): void {
	checkOpenApiMetadata();
	checkWorkflowTraceSummary();
	checkRuntimeBoundaries();
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
	expect(meta.execution_contract_version === "tool_execution_v5", "execution contract mismatch");
	expect(
		meta.response_contract === "execution_finalization_response_v6",
		"response contract mismatch",
	);
	expect(
		meta.workflow_trace_summary_version === "workflow-trace-summary-v7",
		"workflow trace version mismatch",
	);
	const policy = asRecord(meta.versioning_policy, "versioning_policy");
	expectEqualJson(
		new Set(Object.keys(policy)),
		new Set(["execution_contract_version", "response_contract", "workflow_trace_summary_version"]),
		"version policy keys",
	);
	const components = asRecord(openapi.components, "components");
	const componentSchemas = asRecord(components.schemas, "components.schemas");
	const executionRunId = asRecord(componentSchemas.ExecutionRunId, "ExecutionRunId");
	expect(executionRunId.type === "string", "ExecutionRunId must be a string");
	expect(
		executionRunId.pattern === "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
		"ExecutionRunId pattern mismatch",
	);
	const parameters = asRecord(components.parameters, "components.parameters");
	const runIdParameter = asRecord(parameters.RunId, "RunId parameter");
	expectEqualJson(
		asRecord(runIdParameter.schema, "RunId parameter schema"),
		{ $ref: "#/components/schemas/ExecutionRunId" },
		"RunId parameter schema ref",
	);
	expectEqualJson(
		properties(
			asRecord(componentSchemas.ExecutionRunCreateRequest, "ExecutionRunCreateRequest"),
			"ExecutionRunCreateRequest",
		).run_id,
		{ $ref: "#/components/schemas/ExecutionRunId" },
		"execution run create run_id ref",
	);
	const componentResponses = asRecord(components.responses, "components.responses");
	const appApiErrorResponse = asRecord(
		componentResponses.AppApiErrorResponse,
		"AppApiErrorResponse",
	);
	const errorHeaders = asRecord(appApiErrorResponse.headers, "AppApiErrorResponse headers");
	const errorCacheControl = asRecord(
		errorHeaders["Cache-Control"],
		"AppApiErrorResponse Cache-Control",
	);
	expectEqualJson(
		asRecord(errorCacheControl.schema, "AppApiErrorResponse Cache-Control schema"),
		{ const: "no-store" },
		"AppApiErrorResponse Cache-Control",
	);
	const errorContent = asRecord(appApiErrorResponse.content, "AppApiErrorResponse content");
	const errorJSON = asRecord(errorContent["application/json"], "AppApiErrorResponse JSON");
	expectEqualJson(
		asRecord(errorJSON.schema, "AppApiErrorResponse JSON schema"),
		{ $ref: "#/components/schemas/AppApiErrorEnvelope" },
		"AppApiErrorResponse schema ref",
	);
	const paths = asRecord(openapi.paths, "paths");
	const inputPath = asRecord(
		paths["/api/internal/execution/runs/{runId}/input"],
		"execution input path",
	);
	expect(inputPath.delete === undefined, "execution input must not expose a DELETE operation");
	const operation = asRecord(inputPath.get, "execution input get");
	const responses = asRecord(operation.responses, "execution input get responses");
	const expectedStatuses = ["200", "400", "401", "404", "409", "503"];
	expectEqualJson(
		new Set(Object.keys(responses)),
		new Set(expectedStatuses),
		"execution input get statuses",
	);
	const response = asRecord(responses["200"], "execution input get 200");
	const headers = asRecord(response.headers, "execution input get 200 headers");
	const cacheControl = asRecord(headers["Cache-Control"], "execution input get Cache-Control");
	const headerSchema = asRecord(cacheControl.schema, "execution input get Cache-Control schema");
	expect(headerSchema.const === "no-store", "execution input get must declare no-store");
	for (const status of expectedStatuses.filter((value) => value !== "200")) {
		expectEqualJson(
			asRecord(responses[status], `execution input get ${status}`),
			{ $ref: "#/components/responses/AppApiErrorResponse" },
			`execution input get ${status} error response ref`,
		);
	}
}

function checkWorkflowTraceSummary(): void {
	const summary = schema("WorkflowTraceSummary");
	const summaryProperties = properties(summary, "WorkflowTraceSummary");
	for (const field of [
		"execution_path",
		"terminal_reason",
		"answer_artifact_refs",
		"runtime_versions",
	]) {
		expectIncludes(summary.required, field, `${field} required`);
	}
	expectEqualJson(
		summaryProperties.execution_path,
		{ $ref: "#/components/schemas/ExecutionPath" },
		"execution path ref",
	);
}

function checkRuntimeBoundaries(): void {
	expectEqualJson(
		schema("ToolID").enum,
		["campus_search", "personal_memory_recall"],
		"tool id enum",
	);
	expectEqualJson(
		schema("ModelVisibleToolName").enum,
		["campus_search", "personal_memory_recall"],
		"model-visible tool vocabulary enum",
	);
	const payload = schema("ExecutionPayload");
	const payloadProperties = properties(payload, "ExecutionPayload");
	expect(payload.additionalProperties === false, "ExecutionPayload must be closed");
	expectEqualJson(
		new Set(Object.keys(payloadProperties)),
		new Set([
			"execution_contract_version",
			"response_contract",
			"user_goal",
			"conversation_id",
			"request_id",
			"tenant_id",
			"safety_identifier",
			"trace",
			"context",
		]),
		"execution payload fields",
	);
	expectEqualJson(
		new Set(payload.required as string[]),
		new Set([
			"execution_contract_version",
			"response_contract",
			"user_goal",
			"conversation_id",
			"request_id",
			"trace",
			"context",
		]),
		"execution payload required fields",
	);
	const conversation = schema("ConversationContext");
	const conversationProperties = properties(conversation, "ConversationContext");
	expectEqualJson(
		new Set(Object.keys(conversationProperties)),
		new Set([
			"schema_version",
			"conversation_id",
			"user_message_id",
			"parent_message_id",
			"current_user_message",
			"recent_turns",
			"session_state",
		]),
		"conversation context fields",
	);
	expectEqualJson(
		new Set(conversation.required as string[]),
		new Set([
			"schema_version",
			"conversation_id",
			"user_message_id",
			"current_user_message",
			"recent_turns",
			"session_state",
		]),
		"conversation context required fields",
	);
	const runCreate = schema("ExecutionRunCreateRequest");
	const runCreateProperties = properties(runCreate, "ExecutionRunCreateRequest");
	expect(runCreate.additionalProperties === false, "ExecutionRunCreateRequest must be closed");
	expectEqualJson(
		new Set(Object.keys(runCreateProperties)),
		new Set([
			"run_id",
			"conversation_id",
			"turn_id",
			"request_id",
			"trace_id",
			"owner_user_id",
			"personal_memory_recall_allowed",
			"surface",
			"runtime_versions",
			"metadata",
		]),
		"execution run create fields",
	);
	expectEqualJson(
		runCreateProperties.metadata,
		{ $ref: "#/components/schemas/ExecutionRunMetadata" },
		"run metadata ref",
	);
	const runMetadata = schema("ExecutionRunMetadata");
	const runMetadataProperties = properties(runMetadata, "ExecutionRunMetadata");
	expect(runMetadata.additionalProperties === false, "ExecutionRunMetadata must be closed");
	expectEqualJson(
		new Set(Object.keys(runMetadataProperties)),
		new Set(["execution_contract_version", "execution_input_ref", "execution_input_sha256"]),
		"execution run metadata fields",
	);
	expectEqualJson(
		new Set(runMetadata.required as string[]),
		new Set(["execution_contract_version", "execution_input_ref", "execution_input_sha256"]),
		"execution run metadata required fields",
	);
	expect(
		!("execution_payload" in runMetadataProperties),
		"ExecutionRunMetadata must not carry raw execution payload",
	);
	const eventPage = asRecord(
		asRecord(
			asRecord(
				asRecord(
					asRecord(loadOpenApi().paths, "paths")["/internal/execution/runs/{runId}/events"],
					"events path",
				).get,
				"events get",
			).responses,
			"events responses",
		)["200"],
		"events 200",
	);
	const eventPageSchema = asRecord(
		asRecord(
			asRecord(eventPage.content, "events content")["application/json"],
			"events application/json",
		).schema,
		"events page schema",
	);
	expectIncludes(eventPageSchema.required, "next_sequence", "event next_sequence required");
	expectEqualJson(
		schema("ExecutionRequestContext").not,
		{ required: ["profile_memory"] },
		"profile memory ban",
	);
}

function checkExecutionResponseDiagnostics(): void {
	const response = schema("ExecutionFinalizationResponse");
	const responseProperties = properties(response, "ExecutionFinalizationResponse");
	expectIncludes(response.required, "model_usage", "model usage required");
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
			"execution.dispatch_ms",
			"agent.schedule_to_start_ms",
			"stream.first_delta_persist_ms",
			"stream.app_api_ttft_ms",
			"stream.orchestration_overhead_ms",
			"execution.admission_ms",
			"memory.recall_ms",
			"agent.primary_ms",
			"agent.runtime_ms",
			"agent.first_delta_ms",
			"tool.total_ms",
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
		"interface ExecutionPayloadWire",
		"interface ExecutionRunMetadataWire",
		"interface ExecutionRunCreateRequestWire",
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
		"ExecutionRunIDPattern",
		"func ValidExecutionRunID",
		"func DecodeExecutionPayloadWireJSON",
		"func DecodeExecutionRunCreateRequestWireJSON",
	]) {
		expect(goContract.includes(requiredSymbol), `Go generated contract missing ${requiredSymbol}`);
	}
}

function checkFixtureMatrix(): void {
	const delegate = loadFixture("execution_payload.valid.json");
	expect(
		delegate.execution_contract_version === "tool_execution_v5",
		"delegate execution contract",
	);
	expect(
		delegate.response_contract === "execution_finalization_response_v6",
		"delegate response contract",
	);
	expectFixtureValidity("execution_payload.valid.json", "ExecutionPayload", true);
	expectFixtureValidity("execution_run_create.valid.json", "ExecutionRunCreateRequest", true);
	for (const fixtureName of [
		"execution_payload_extra_field.invalid.json",
		"execution_payload_invalid_enum.invalid.json",
		"execution_payload_invalid_version.invalid.json",
	]) {
		expectFixtureValidity(fixtureName, "ExecutionPayload", false);
	}
	for (const fixtureName of [
		"execution_run_create_raw_payload.invalid.json",
		"execution_run_create_ref.invalid.json",
		"execution_run_create_run_id.invalid.json",
		"execution_run_create_sha.invalid.json",
	]) {
		expectFixtureValidity(fixtureName, "ExecutionRunCreateRequest", false);
	}
	for (const fixtureName of [
		"execution_payload_extra_field.invalid.json",
		"execution_payload_invalid_enum.invalid.json",
		"execution_payload_invalid_version.invalid.json",
		"execution_run_create_raw_payload.invalid.json",
		"execution_run_create_ref.invalid.json",
		"execution_run_create_run_id.invalid.json",
		"execution_run_create_sha.invalid.json",
		"execution_run_create.valid.json",
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

function expectFixtureValidity(
	fixtureName: string,
	schemaName: string,
	expectedValid: boolean,
): void {
	const openapi = loadOpenApi();
	const componentSchemas = asRecord(asRecord(openapi.components, "components").schemas, "schemas");
	const validator = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(
		{
			$schema: "https://json-schema.org/draft/2020-12/schema",
			$ref: `#/components/schemas/${schemaName}`,
			components: { schemas: componentSchemas },
		},
	);
	const valid = validator(loadFixture(fixtureName));
	expect(
		valid === expectedValid,
		`${fixtureName} validity mismatch for ${schemaName}: ${JSON.stringify(validator.errors)}`,
	);
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
