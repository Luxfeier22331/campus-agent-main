package runtimepolicy

import "testing"

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
	if _, ok := registry.ArtifactByKind("academic_calendar_facts"); !ok {
		t.Fatal("academic_calendar_facts missing from workflow artifact registry")
	}
	if artifact, ok := registry.ArtifactByKind("calendar_fact"); !ok ||
		artifact.Kind != "academic_calendar_facts" {
		t.Fatalf("calendar_fact alias = %#v/%v, want academic_calendar_facts", artifact, ok)
	}
}

func TestWorkflowArtifactRegistryValidatesDefaultRuntimeBindings(t *testing.T) {
	agents, err := LoadAgentSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadAgentSpecRegistry default failed: %v", err)
	}
	tools, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}
	artifacts, err := LoadWorkflowArtifactRegistry("")
	if err != nil {
		t.Fatalf("LoadWorkflowArtifactRegistry default failed: %v", err)
	}
	if err := ValidateAgentSpecProjectionKindsAgainstArtifacts(agents, artifacts); err != nil {
		t.Fatalf("AgentSpec projection kinds drifted from artifact registry: %v", err)
	}
	if err := ValidateToolSpecProducerToolsAgainstArtifacts(tools, artifacts); err != nil {
		t.Fatalf("ToolSpec producer tools drifted from artifact registry: %v", err)
	}
	if err := ValidateCapabilityBindings(agents, tools, artifacts); err != nil {
		t.Fatalf("workflow capability bindings drifted from runtime registries: %v", err)
	}
}
