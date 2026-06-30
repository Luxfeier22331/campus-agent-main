package runtimepolicy

import (
	"reflect"
	"testing"
)

func TestPrimaryAgentVisibleToolNamesNarrowsInstitutionalAccountKnowledge(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}
	got := PrimaryAgentVisibleToolNames(
		[]string{"knowledge_query", "transport_schedule_lookup", "campus_notice_discover"},
		"",
		"校园网密码怎么改？",
		policy,
	)
	want := []string{"knowledge_query"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("visible tool names = %#v, want %#v", got, want)
	}
}

func TestPrimaryAgentVisibleToolNamesPreservesExplicitToolHint(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}
	got := PrimaryAgentVisibleToolNames(
		[]string{"transport_schedule_lookup"},
		"transport_schedule_lookup",
		"校园网密码怎么改？",
		policy,
	)
	want := []string{"transport_schedule_lookup"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("visible tool names = %#v, want %#v", got, want)
	}
}

func TestPrimaryAgentVisibleToolNamesKeepsServiceGuideQuestionOpen(t *testing.T) {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}
	got := PrimaryAgentVisibleToolNames(
		[]string{"knowledge_query", "transport_schedule_lookup", "campus_notice_discover"},
		"",
		"VPN入口在哪里？",
		policy,
	)
	want := []string{"knowledge_query", "transport_schedule_lookup", "campus_notice_discover"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("visible tool names = %#v, want %#v", got, want)
	}
}
