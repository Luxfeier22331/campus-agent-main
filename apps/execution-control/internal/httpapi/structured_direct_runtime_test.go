package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

const (
	testTransportPayloadSchemaRef = "https://muc.wiki/campus-agent/schemas/campus-services-tool-contracts.v1.schema.json#/$defs/TransportScheduleLookupPayload"
	testTransportResultSchemaRef  = "https://muc.wiki/campus-agent/schemas/campus-services-tool-contracts.v1.schema.json#/$defs/TransportScheduleLookupResult"
)

func TestDirectStructuredHandoffDecisionSkipsTypedActivityAdmittedTools(t *testing.T) {
	handoff := &execution.RuntimeHandoff{
		Capability:   "campus_services",
		PayloadKind:  "transport_schedule_lookup",
		AllowedTools: []string{"transport_schedule_lookup"},
	}
	registry := runtimepolicy.ToolSpecRegistry{
		SchemaVersion:   runtimepolicy.ToolSpecSchemaVersion,
		RegistryVersion: "test",
		Tools: []runtimepolicy.ToolSpec{
			{
				Name:             "transport_schedule_lookup",
				OwnerCapability:  "campus_services",
				Capability:       "campus_services",
				PayloadKind:      "transport_schedule_lookup",
				PayloadSchemaRef: testTransportPayloadSchemaRef,
				ResultSchemaRef:  testTransportResultSchemaRef,
				Backend:          "internal_structured_query_service",
				Surface:          "structured_handoff",
				ReadOnly:         true,
				Active:           true,
				FunctionSchema: runtimepolicy.ToolFunctionSchemaSpec{
					Available: true,
					Strict:    true,
				},
				RuntimePosture: "typed_activity_admitted",
			},
		},
	}

	if directStructuredHandoffDecision(handoff, registry) {
		t.Fatal("typed_activity_admitted tool must not direct-execute in Go answer path")
	}
}

func TestDirectStructuredHandoffDecisionAllowsTypedHandoffOnlyTools(t *testing.T) {
	handoff := &execution.RuntimeHandoff{
		Capability:   "campus_services",
		PayloadKind:  "transport_schedule_lookup",
		AllowedTools: []string{"transport_schedule_lookup"},
	}
	registry := runtimepolicy.ToolSpecRegistry{
		SchemaVersion:   runtimepolicy.ToolSpecSchemaVersion,
		RegistryVersion: "test",
		Tools: []runtimepolicy.ToolSpec{
			{
				Name:             "transport_schedule_lookup",
				OwnerCapability:  "campus_services",
				Capability:       "campus_services",
				PayloadKind:      "transport_schedule_lookup",
				PayloadSchemaRef: testTransportPayloadSchemaRef,
				ResultSchemaRef:  testTransportResultSchemaRef,
				Backend:          "internal_structured_query_service",
				Surface:          "structured_handoff",
				ReadOnly:         true,
				Active:           true,
				FunctionSchema: runtimepolicy.ToolFunctionSchemaSpec{
					Available: true,
					Strict:    true,
				},
				RuntimePosture: "typed_handoff_only",
			},
		},
	}

	if !directStructuredHandoffDecision(handoff, registry) {
		t.Fatal("typed_handoff_only tool should direct-execute in Go answer path")
	}
}

func TestShapeStructuredExecutionResponseReturnsExplicitFinalizerFailureEnvelope(t *testing.T) {
	response := shapeStructuredExecutionResponse(
		"campus_services",
		"transport_schedule_lookup",
		map[string]any{
			"outcome": "resolved_current",
		},
		"trace-structured-finalizer-failure",
		executionFinalizerContext{
			Branch: "delegate",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				SelectedCapability: "knowledge",
				RoutingNextAction:  "delegate",
				PlanningOutcome:    "preplanned",
			},
			Handoff: &execution.RuntimeHandoff{
				Capability:   "knowledge",
				PayloadKind:  "rag_request",
				AllowedTools: []string{"retrieval.query"},
			},
		},
	)

	if response["status"] != "error" {
		t.Fatalf("status = %v, want error", response["status"])
	}
	errorBody, ok := response["error"].(map[string]any)
	if !ok {
		t.Fatalf("error = %#v, want object", response["error"])
	}
	if errorBody["code"] != "structured_finalization_failed" {
		t.Fatalf("error.code = %v, want structured_finalization_failed", errorBody["code"])
	}
	if response["answer_text"] != "结构化查询结果未通过 execution finalization。" {
		t.Fatalf("answer_text = %v, want explicit finalizer failure text", response["answer_text"])
	}
}
