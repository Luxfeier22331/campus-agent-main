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

func TestDirectToolHandoffDecisionSkipsClosedTools(t *testing.T) {
	handoff := &execution.RuntimeHandoff{
		ToolTarget:   "transport_schedule_lookup",
		PayloadKind:  "transport_schedule_lookup",
		AllowedTools: []string{"transport_schedule_lookup"},
	}
	registry := runtimepolicy.ToolSpecRegistry{
		SchemaVersion:   runtimepolicy.ToolRegistrySchemaVersion,
		RegistryVersion: "test",
		Tools: []runtimepolicy.ToolSpec{
			{
				Name:                   "transport_schedule_lookup",
				Description:            "Lookup campus transport schedules.",
				Exposure:               "closed",
				ReadOnly:               true,
				PayloadSchemaRef:       testTransportPayloadSchemaRef,
				ResultSchemaRef:        testTransportResultSchemaRef,
				Handler:                runtimepolicy.ToolSpecHandler{Type: "execution_control_internal_query", Endpoint: "/internal/tools/transport_schedule_lookup"},
				TimeoutMS:              5000,
				ResultProjectionPolicy: "bounded_json",
			},
		},
	}

	if directToolHandoffDecision(handoff, registry) {
		t.Fatal("closed tool must not direct-execute in Go answer path")
	}
}

func TestDirectToolHandoffDecisionAllowsInternalQueryTools(t *testing.T) {
	handoff := &execution.RuntimeHandoff{
		ToolTarget:   "transport_schedule_lookup",
		PayloadKind:  "transport_schedule_lookup",
		AllowedTools: []string{"transport_schedule_lookup"},
	}
	registry := runtimepolicy.ToolSpecRegistry{
		SchemaVersion:   runtimepolicy.ToolRegistrySchemaVersion,
		RegistryVersion: "test",
		Tools: []runtimepolicy.ToolSpec{
			{
				Name:                   "transport_schedule_lookup",
				Description:            "Lookup campus transport schedules.",
				Exposure:               "internal_only",
				ReadOnly:               true,
				PayloadSchemaRef:       testTransportPayloadSchemaRef,
				ResultSchemaRef:        testTransportResultSchemaRef,
				Handler:                runtimepolicy.ToolSpecHandler{Type: "execution_control_internal_query", Endpoint: "/internal/tools/transport_schedule_lookup"},
				TimeoutMS:              5000,
				ResultProjectionPolicy: "bounded_json",
			},
		},
	}

	if !directToolHandoffDecision(handoff, registry) {
		t.Fatal("internal query tool should direct-execute in Go answer path")
	}
}

func TestDirectToolHandoffDecisionSkipsWorkflowSignalTools(t *testing.T) {
	handoff := &execution.RuntimeHandoff{
		ToolTarget:   "transport_schedule_lookup",
		PayloadKind:  "transport_schedule_lookup",
		AllowedTools: []string{"transport_schedule_lookup"},
	}
	registry := runtimepolicy.ToolSpecRegistry{
		SchemaVersion:   runtimepolicy.ToolRegistrySchemaVersion,
		RegistryVersion: "test",
		Tools: []runtimepolicy.ToolSpec{
			{
				Name:                   "transport_schedule_lookup",
				Description:            "Lookup campus transport schedules.",
				Exposure:               "internal_only",
				ReadOnly:               true,
				PayloadSchemaRef:       testTransportPayloadSchemaRef,
				ResultSchemaRef:        testTransportResultSchemaRef,
				Handler:                runtimepolicy.ToolSpecHandler{Type: "workflow_signal"},
				TimeoutMS:              5000,
				ResultProjectionPolicy: "bounded_json",
			},
		},
	}

	if directToolHandoffDecision(handoff, registry) {
		t.Fatal("workflow signal tool must not direct-execute in Go answer path")
	}
}

func TestShapeStructuredExecutionResponseReturnsExplicitFinalizerFailureEnvelope(t *testing.T) {
	response := shapeStructuredExecutionResponse(
		"transport_schedule_lookup",
		"transport_schedule_lookup",
		map[string]any{
			"outcome": "resolved_current",
		},
		"trace-structured-finalizer-failure",
		executionFinalizerContext{
			Branch: "delegate",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				SelectedTool:      "knowledge_query",
				RoutingNextAction: "delegate",
				PlanningOutcome:   "preplanned",
			},
			Handoff: &execution.RuntimeHandoff{
				ToolTarget:   "knowledge_query",
				PayloadKind:  "rag_request",
				AllowedTools: []string{"knowledge_query"},
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
