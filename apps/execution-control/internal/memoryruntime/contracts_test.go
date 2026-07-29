package memoryruntime

import (
	"strings"
	"testing"
)

func TestValidateRecallRequestRequiresQueryTimestamp(t *testing.T) {
	request := validRecallRequestForTest()
	request.QueryTimestamp = ""

	err := ValidateRecallRequest(request)
	if err == nil || !strings.Contains(err.Error(), "query_timestamp is required") {
		t.Fatalf("error = %v, want missing query_timestamp failure", err)
	}
}

func TestValidateRecallRequestRequiresRFC3339QueryTimestamp(t *testing.T) {
	request := validRecallRequestForTest()
	request.QueryTimestamp = "2026-06-16 10:00:00"

	err := ValidateRecallRequest(request)
	if err == nil || !strings.Contains(err.Error(), "query_timestamp must be RFC3339") {
		t.Fatalf("error = %v, want RFC3339 query_timestamp failure", err)
	}
}

func TestValidateAppendConversationTurnRequiresUserMessageCreatedAt(t *testing.T) {
	request := validAppendConversationTurnRequestForTest()
	request.UserMessageCreatedAt = ""

	err := ValidateAppendConversationTurnRequest(request)
	if err == nil || !strings.Contains(err.Error(), "user_message_created_at is required") {
		t.Fatalf("error = %v, want missing user_message_created_at failure", err)
	}
}

func TestValidateAppendConversationTurnRequiresRFC3339UserMessageCreatedAt(t *testing.T) {
	request := validAppendConversationTurnRequestForTest()
	request.UserMessageCreatedAt = "2026-06-16 10:00:00"

	err := ValidateAppendConversationTurnRequest(request)
	if err == nil || !strings.Contains(err.Error(), "user_message_created_at must be RFC3339") {
		t.Fatalf("error = %v, want RFC3339 user_message_created_at failure", err)
	}
}

func TestValidatePersonalMemoryCommandRequiresV2SchemaAndCanonicalSupersessionScope(t *testing.T) {
	base := PersonalMemoryCommandRequest{
		CommandID:         "cmd-transition",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant-main",
		UserID:            "user-memory-test",
	}
	if err := ValidatePersonalMemoryCommandRequest(base); err != nil {
		t.Fatalf("valid command: %v", err)
	}

	missingVersion := base
	missingVersion.SchemaVersion = ""
	if err := ValidatePersonalMemoryCommandRequest(missingVersion); err == nil || !strings.Contains(err.Error(), "schema_version") {
		t.Fatalf("missing schema error = %v", err)
	}

	wrongScope := base
	wrongScope.SupersessionScope = "owner:erase"
	if err := ValidatePersonalMemoryCommandRequest(wrongScope); err == nil || !strings.Contains(err.Error(), "supersession_scope") {
		t.Fatalf("wrong scope error = %v", err)
	}

	malformedTimestamp := base
	malformedTimestamp.SourceUpdatedAt = "2026-07-16 00:00:00"
	if err := ValidatePersonalMemoryCommandRequest(malformedTimestamp); err == nil || !strings.Contains(err.Error(), "source_updated_at must be RFC3339") {
		t.Fatalf("malformed source timestamp error = %v", err)
	}
}

func validRecallRequestForTest() RecallRequest {
	return RecallRequest{
		OwnerGeneration: 1,
		OwnerSequence:   0,
		QueryTimestamp:  "2026-06-16T10:00:00Z",
		RunID:           "run-memory-test",
		TenantID:        "tenant-main",
		ThreadID:        "conv-memory-test",
		UserGoal:        "我如何准备保研材料？",
		UserID:          "user-memory-test",
	}
}

func validAppendConversationTurnRequestForTest() AppendConversationTurnRequest {
	return AppendConversationTurnRequest{
		OwnerGeneration:      1,
		OwnerSequence:        0,
		RunID:                "run-memory-test",
		TenantID:             "tenant-main",
		ThreadID:             "conv-memory-test",
		UserID:               "user-memory-test",
		UserMessage:          "我主要关注培养方案",
		UserMessageCreatedAt: "2026-06-16T10:00:00Z",
		UserMessageID:        "msg-user-memory-test",
	}
}
