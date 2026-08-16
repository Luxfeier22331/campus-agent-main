package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
)

func TestCampusDocsRetrievalAdmissionUsesCurrentDocsForKnowledgeRequests(t *testing.T) {
	server := newServerForTest()
	querySHA256, err := server.campusDocsQuerySHA256ForAdmission(
		contracts.ExecutionPayloadWire{UserGoal: "学生请假手续是什么？"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !validSHA256Ref(querySHA256) {
		t.Fatalf("query hash = %q", querySHA256)
	}
}

func TestCampusDocsRetrievalAdmissionIncludesEveryNonEmptyRequest(t *testing.T) {
	server := newServerForTest()
	for _, query := range []string{"你好", "你是谁", "hello what can you do", "请把这句话润色：校园很美"} {
		querySHA256, err := server.campusDocsQuerySHA256ForAdmission(
			contracts.ExecutionPayloadWire{UserGoal: query},
		)
		if err != nil {
			t.Fatal(err)
		}
		if !validSHA256Ref(querySHA256) {
			t.Fatalf("query %q did not receive Campus Docs retrieval admission: %q", query, querySHA256)
		}
	}
}
