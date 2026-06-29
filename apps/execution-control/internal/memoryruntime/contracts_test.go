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

func TestValidatePersonalMemoryOperationStatusRequiresOperationID(t *testing.T) {
	err := ValidatePersonalMemoryOperationStatusRequest(PersonalMemoryOperationStatusRequest{
		UserID: "user-memory-test",
	})
	if err == nil || !strings.Contains(err.Error(), "operation_id is required") {
		t.Fatalf("error = %v, want missing operation_id failure", err)
	}
}

func TestFinalizePersonalMemoryOperationStatusRejectsMissingStatus(t *testing.T) {
	_, err := FinalizePersonalMemoryOperationStatusResult(PersonalMemoryOperationStatusResult{
		OperationID:   "op-test-retain",
		SchemaVersion: "memory_operation_status_result_v1",
		UserID:        "user-memory-test",
	})
	if err == nil || !strings.Contains(err.Error(), "status is required") {
		t.Fatalf("error = %v, want missing status failure", err)
	}
}

func validRecallRequestForTest() RecallRequest {
	return RecallRequest{
		QueryTimestamp: "2026-06-16T10:00:00Z",
		RequestedTool:  "knowledge_query",
		RunID:          "run-memory-test",
		TenantID:       "tenant-main",
		ThreadID:       "conv-memory-test",
		UserGoal:       "我如何准备保研材料？",
		UserID:         "user-memory-test",
	}
}

func validAppendConversationTurnRequestForTest() AppendConversationTurnRequest {
	return AppendConversationTurnRequest{
		AssistantMessage:     "可以，我会优先结合培养方案回答。",
		RunID:                "run-memory-test",
		TenantID:             "tenant-main",
		ThreadID:             "conv-memory-test",
		UserID:               "user-memory-test",
		UserMessage:          "我主要关注培养方案",
		UserMessageCreatedAt: "2026-06-16T10:00:00Z",
	}
}
