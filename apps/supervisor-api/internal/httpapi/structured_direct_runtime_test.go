package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
)

func TestDirectStructuredHandoffDecisionSkipsSdkAdmittedTools(t *testing.T) {
	handoff := &execution.RuntimeHandoff{
		Target:       "campus-services-agent",
		PayloadKind:  "service_status_lookup",
		AllowedTools: []string{"service_status_lookup"},
	}
	registry := runtimepolicy.ToolSpecRegistry{
		SchemaVersion:   runtimepolicy.ToolSpecSchemaVersion,
		RegistryVersion: "test",
		Tools: []runtimepolicy.ToolSpec{
			{
				Name:             "service_status_lookup",
				OwnerAgent:       "campus-services-agent",
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
				RuntimePosture: "sdk_adapter_admitted",
			},
		},
	}

	if directStructuredHandoffDecision(handoff, registry) {
		t.Fatal("sdk_adapter_admitted tool must not direct-execute in Go answer path")
	}
}

func TestDirectStructuredHandoffDecisionAllowsTypedHandoffOnlyTools(t *testing.T) {
	handoff := &execution.RuntimeHandoff{
		Target:       "campus-services-agent",
		PayloadKind:  "service_status_lookup",
		AllowedTools: []string{"service_status_lookup"},
	}
	registry := runtimepolicy.ToolSpecRegistry{
		SchemaVersion:   runtimepolicy.ToolSpecSchemaVersion,
		RegistryVersion: "test",
		Tools: []runtimepolicy.ToolSpec{
			{
				Name:             "service_status_lookup",
				OwnerAgent:       "campus-services-agent",
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
