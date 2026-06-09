package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

func TestDirectStructuredHandoffDecisionSkipsTypedActivityAdmittedTools(t *testing.T) {
	handoff := &execution.RuntimeHandoff{
		Capability:   "campus_services",
		PayloadKind:  "service_status_lookup",
		AllowedTools: []string{"service_status_lookup"},
	}
	registry := runtimepolicy.ToolSpecRegistry{
		SchemaVersion:   runtimepolicy.ToolSpecSchemaVersion,
		RegistryVersion: "test",
		Tools: []runtimepolicy.ToolSpec{
			{
				Name:             "service_status_lookup",
				OwnerCapability:  "campus_services",
				Capability:       "campus_services",
				PayloadKind:      "service_status_lookup",
				PayloadSchemaRef: "campus_contracts.models_tools.ServiceStatusLookupPayload",
				ResultSchemaRef:  "campus_contracts.models_tools.ServiceStatusLookupResult",
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
		PayloadKind:  "service_status_lookup",
		AllowedTools: []string{"service_status_lookup"},
	}
	registry := runtimepolicy.ToolSpecRegistry{
		SchemaVersion:   runtimepolicy.ToolSpecSchemaVersion,
		RegistryVersion: "test",
		Tools: []runtimepolicy.ToolSpec{
			{
				Name:             "service_status_lookup",
				OwnerCapability:  "campus_services",
				Capability:       "campus_services",
				PayloadKind:      "service_status_lookup",
				PayloadSchemaRef: "campus_contracts.models_tools.ServiceStatusLookupPayload",
				ResultSchemaRef:  "campus_contracts.models_tools.ServiceStatusLookupResult",
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

func TestShapeStructuredSupervisorResponseReturnsExplicitFinalizerFailureEnvelope(t *testing.T) {
	response := shapeStructuredSupervisorResponse(
		"campus_services",
		"service_status_lookup",
		map[string]any{
			"outcome": "resolved_current",
		},
		"trace-structured-finalizer-failure",
		supervisorFinalizerContext{
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
	if response["answer_text"] != "结构化查询结果未通过 supervisor finalization。" {
		t.Fatalf("answer_text = %v, want explicit finalizer failure text", response["answer_text"])
	}
}
