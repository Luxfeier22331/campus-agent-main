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
	capabilities, err := LoadCapabilitySpecRegistry("")
	if err != nil {
		t.Fatalf("LoadCapabilitySpecRegistry default failed: %v", err)
	}
	tools, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}
	artifacts, err := LoadWorkflowArtifactRegistry("")
	if err != nil {
		t.Fatalf("LoadWorkflowArtifactRegistry default failed: %v", err)
	}
	if err := ValidateCapabilitySpecProjectionKindsAgainstArtifacts(capabilities, artifacts); err != nil {
		t.Fatalf("CapabilitySpec projection kinds drifted from artifact registry: %v", err)
	}
	if err := ValidateToolSpecProducerToolsAgainstArtifacts(tools, artifacts); err != nil {
		t.Fatalf("ToolSpec producer tools drifted from artifact registry: %v", err)
	}
	if err := ValidateCapabilityBindings(capabilities, tools, artifacts); err != nil {
		t.Fatalf("workflow capability bindings drifted from runtime registries: %v", err)
	}
}

func TestValidateCapabilityBindingsAllowsClosedBindingUnderOpenCapability(t *testing.T) {
	capabilities, tools, artifacts := loadRuntimePolicyRegistries(t)

	if err := ValidateCapabilityBindings(capabilities, tools, artifacts); err != nil {
		t.Fatalf("ValidateCapabilityBindings() failed: %v", err)
	}
}

func TestValidateCapabilityBindingsRejectsOpenUnsupportedProjection(t *testing.T) {
	capabilities, tools, artifacts := loadRuntimePolicyRegistries(t)
	markArtifactUnsupported(&artifacts, "schedule_baseline")

	err := ValidateCapabilityBindings(capabilities, tools, artifacts)
	if err == nil {
		t.Fatal("ValidateCapabilityBindings() succeeded, want unsupported projection failure")
	}
	if got := err.Error(); !strings.Contains(got, "unsupported projection") {
		t.Fatalf("ValidateCapabilityBindings() error = %q, want unsupported projection", got)
	}
}

func TestValidateModelVisibleToolArtifactGateRejectsClosedBinding(t *testing.T) {
	_, _, artifacts := loadRuntimePolicyRegistries(t)
	tool := ToolSpec{
		Name:             "transport_schedule_lookup",
		OwnerCapability:  "campus_services",
		Capability:       "campus_services",
		PayloadKind:      "transport_schedule_lookup",
		PayloadSchemaRef: transportPayloadSchemaRef,
		ResultSchemaRef:  transportResultSchemaRef,
		Backend:          "internal_structured_query_service",
		Surface:          "structured_handoff",
		ReadOnly:         true,
		Active:           false,
		FunctionSchema:   ToolFunctionSchemaSpec{Available: false, Strict: true},
		RuntimePosture:   "closed",
		Description:      "Lookup current campus shuttle timetable.",
	}

	err := ValidateModelVisibleToolArtifactGate(tool, artifacts)
	if err == nil {
		t.Fatal("ValidateModelVisibleToolArtifactGate() succeeded, want closed tool failure")
	}
	if got := err.Error(); !strings.Contains(got, "model-visible tool must be active") {
		t.Fatalf("ValidateModelVisibleToolArtifactGate() error = %q, want active/posture failure", got)
	}
}

func TestValidateModelVisibleToolArtifactGateRejectsOpenUnsupportedProjection(t *testing.T) {
	_, tools, artifacts := loadRuntimePolicyRegistries(t)
	markArtifactUnsupported(&artifacts, "schedule_baseline")
	tool, ok := tools.ToolByName("transport_schedule_lookup")
	if !ok {
		t.Fatal("transport_schedule_lookup missing from tool registry")
	}

	err := ValidateModelVisibleToolArtifactGate(tool, artifacts)
	if err == nil {
		t.Fatal("ValidateModelVisibleToolArtifactGate() succeeded, want unsupported projection failure")
	}
	if got := err.Error(); !strings.Contains(got, "unsupported artifact schedule_baseline") {
		t.Fatalf("ValidateModelVisibleToolArtifactGate() error = %q, want unsupported artifact", got)
	}
}

func TestValidateModelVisibleToolArtifactGateAllowsOpenSupportedProjection(t *testing.T) {
	_, tools, artifacts := loadRuntimePolicyRegistries(t)
	tool, ok := tools.ToolByName("transport_schedule_lookup")
	if !ok {
		t.Fatal("transport_schedule_lookup missing from tool registry")
	}

	if err := ValidateModelVisibleToolArtifactGate(tool, artifacts); err != nil {
		t.Fatalf("ValidateModelVisibleToolArtifactGate() failed: %v", err)
	}
}

func loadRuntimePolicyRegistries(
	t *testing.T,
) (CapabilitySpecRegistry, ToolSpecRegistry, WorkflowArtifactRegistry) {
	t.Helper()
	capabilities, err := LoadCapabilitySpecRegistry("")
	if err != nil {
		t.Fatalf("LoadCapabilitySpecRegistry default failed: %v", err)
	}
	tools, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}
	artifacts, err := LoadWorkflowArtifactRegistry("")
	if err != nil {
		t.Fatalf("LoadWorkflowArtifactRegistry default failed: %v", err)
	}
	return capabilities, tools, artifacts
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
		registry.Artifacts[index].CurrentProjectionSupport = "planned_contract_gap"
		return
	}
}
