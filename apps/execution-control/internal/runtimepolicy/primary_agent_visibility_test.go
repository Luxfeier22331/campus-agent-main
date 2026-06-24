package runtimepolicy

import (
	"reflect"
	"testing"
)

func TestPrimaryAgentVisibleCapabilitiesNarrowsInstitutionalAccountKnowledge(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}
	got := PrimaryAgentVisibleCapabilities(
		[]string{"knowledge", "campus_services", "notice"},
		"",
		"校园网密码怎么改？",
		policy,
	)
	want := []string{"knowledge"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("visible capabilities = %#v, want %#v", got, want)
	}
}

func TestPrimaryAgentVisibleCapabilitiesPreservesExplicitCapability(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}
	got := PrimaryAgentVisibleCapabilities(
		[]string{"campus_services"},
		"campus_services",
		"校园网密码怎么改？",
		policy,
	)
	want := []string{"campus_services"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("visible capabilities = %#v, want %#v", got, want)
	}
}

func TestPrimaryAgentVisibleCapabilitiesKeepsServiceGuideQuestionOpen(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}
	got := PrimaryAgentVisibleCapabilities(
		[]string{"knowledge", "campus_services", "notice"},
		"",
		"VPN入口在哪里？",
		policy,
	)
	want := []string{"knowledge", "campus_services", "notice"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("visible capabilities = %#v, want %#v", got, want)
	}
}
