package runtimepolicy

import (
	"strings"
	"testing"
)

func TestWorkflowArtifactRegistryLoadsDefaultOntology(t *testing.T) {
	registry, err := LoadWorkflowArtifactRegistry("")
	if err != nil {
		t.Fatalf("LoadWorkflowArtifactRegistry default failed: %v", err)
	}
	if registry.SchemaVersion != WorkflowArtifactRegistrySchemaVersion {
		t.Fatalf(
			"schema_version = %q, want %q",
			registry.SchemaVersion,
			WorkflowArtifactRegistrySchemaVersion,
		)
	}
	if _, ok := registry.ArtifactByKind("schedule_baseline"); !ok {
		t.Fatal("schedule_baseline missing from workflow artifact registry")
	}
}

func TestWorkflowArtifactRegistryValidatesDefaultRuntimeBindings(t *testing.T) {
	tools, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}
	artifacts, err := LoadWorkflowArtifactRegistry("")
	if err != nil {
		t.Fatalf("LoadWorkflowArtifactRegistry default failed: %v", err)
	}
	if err := ValidateToolSpecProducerToolsAgainstArtifacts(tools, artifacts); err != nil {
		t.Fatalf("ToolSpec producer tools drifted from artifact registry: %v", err)
	}
	if err := ValidateWorkflowArtifactBindings(tools, artifacts); err != nil {
		t.Fatalf("workflow artifact bindings drifted from runtime registries: %v", err)
	}
}

func TestValidateToolBindingsAllowsClosedBindingUnderOpenTool(t *testing.T) {
	tools, artifacts := loadRuntimePolicyRegistries(t)

	if err := ValidateWorkflowArtifactBindings(tools, artifacts); err != nil {
		t.Fatalf("ValidateWorkflowArtifactBindings() failed: %v", err)
	}
}

func TestValidateToolBindingsRejectsOpenUnsupportedProjection(t *testing.T) {
	tools, artifacts := loadRuntimePolicyRegistries(t)
	markArtifactUnsupported(&artifacts, "schedule_baseline")

	err := ValidateWorkflowArtifactBindings(tools, artifacts)
	if err == nil {
		t.Fatal("ValidateWorkflowArtifactBindings() succeeded, want unsupported projection failure")
	}
	if got := err.Error(); !strings.Contains(got, "unsupported projection") {
		t.Fatalf("ValidateWorkflowArtifactBindings() error = %q, want unsupported projection", got)
	}
}

func TestValidateModelVisibleToolArtifactGateRejectsClosedBinding(t *testing.T) {
	_, artifacts := loadRuntimePolicyRegistries(t)
	tool := ToolSpec{
		Name:                   "transport_schedule_lookup",
		Description:            "Lookup current campus shuttle timetable.",
		Exposure:               "closed",
		ReadOnly:               true,
		RequiresApproval:       false,
		PayloadSchemaRef:       transportPayloadSchemaRef,
		ResultSchemaRef:        transportResultSchemaRef,
		Handler:                ToolSpecHandler{Type: "execution_control_internal_query", Endpoint: "/internal/query/campus-services/transport-schedule"},
		TimeoutMS:              1000,
		ResultProjectionPolicy: "bounded_json",
	}

	err := ValidateModelVisibleToolArtifactGate(tool, artifacts)
	if err == nil {
		t.Fatal("ValidateModelVisibleToolArtifactGate() succeeded, want closed tool failure")
	}
	if got := err.Error(); !strings.Contains(got, "model_visible and read_only") {
		t.Fatalf("ValidateModelVisibleToolArtifactGate() error = %q, want model_visible failure", got)
	}
}

func TestValidateModelVisibleToolArtifactGateRejectsOpenUnsupportedProjection(t *testing.T) {
	tools, artifacts := loadRuntimePolicyRegistries(t)
	markArtifactUnsupported(&artifacts, "schedule_baseline")
	tool, ok := tools.ToolByName("transport_schedule_lookup")
	if !ok {
		t.Fatal("transport_schedule_lookup missing from tool registry")
	}
	tool.Exposure = "model_visible"

	err := ValidateModelVisibleToolArtifactGate(tool, artifacts)
	if err == nil {
		t.Fatal("ValidateModelVisibleToolArtifactGate() succeeded, want unsupported projection failure")
	}
	if got := err.Error(); !strings.Contains(got, "unsupported artifact schedule_baseline") {
		t.Fatalf("ValidateModelVisibleToolArtifactGate() error = %q, want unsupported artifact", got)
	}
}

func TestValidateModelVisibleToolArtifactGateAllowsOpenSupportedProjection(t *testing.T) {
	tools, artifacts := loadRuntimePolicyRegistries(t)
	tool, ok := tools.ToolByName("transport_schedule_lookup")
	if !ok {
		t.Fatal("transport_schedule_lookup missing from tool registry")
	}
	tool.Exposure = "model_visible"

	if err := ValidateModelVisibleToolArtifactGate(tool, artifacts); err != nil {
		t.Fatalf("ValidateModelVisibleToolArtifactGate() failed: %v", err)
	}
}

func loadRuntimePolicyRegistries(
	t *testing.T,
) (ToolSpecRegistry, WorkflowArtifactRegistry) {
	t.Helper()
	tools, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}
	artifacts, err := LoadWorkflowArtifactRegistry("")
	if err != nil {
		t.Fatalf("LoadWorkflowArtifactRegistry default failed: %v", err)
	}
	return tools, artifacts
}

func openArtifactBinding(registry *WorkflowArtifactRegistry, bindingID string) {
	for index, binding := range registry.Bindings {
		if binding.BindingID != bindingID {
			continue
		}
		registry.Bindings[index].OpeningGate = "open"
		return
	}
}

func markArtifactUnsupported(registry *WorkflowArtifactRegistry, kind string) {
	for index, artifact := range registry.Artifacts {
		if artifact.Kind != kind {
			continue
		}
		registry.Artifacts[index].CurrentProjectionSupport = "unsupported_projection"
		return
	}
}
