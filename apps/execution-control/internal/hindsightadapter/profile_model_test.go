package hindsightadapter

import (
	"context"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func TestHindsightGetProfileReturnsExistingModelContent(t *testing.T) {
	client := &fakeHindsightClient{
		bankExists:       true,
		mentalModelFound: true,
		mentalModel: hindsightProfileModelSnapshot{
			Content:         "用户偏好简洁回复",
			IsStale:         true,
			LastRefreshedAt: "2026-09-24T00:00:00Z",
		},
	}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}
	record, err := executor.GetProfile(context.Background(), memoryruntime.ProfileQuery{
		TenantID: "tenant-main", OwnerUserID: "user-profile", OwnerGeneration: 1,
	})
	if err != nil {
		t.Fatalf("get profile: %v", err)
	}
	if record != (memoryruntime.ProfileRecord{
		Content:         "用户偏好简洁回复",
		IsStale:         true,
		LastRefreshedAt: "2026-09-24T00:00:00Z",
	}) {
		t.Fatalf("record = %#v", record)
	}
	if client.createMentalModelCalls != 0 {
		t.Fatalf("create mental model calls = %d, want 0", client.createMentalModelCalls)
	}
}

func TestHindsightGetProfileLazilyCreatesMissingModelAsGenerating(t *testing.T) {
	client := &fakeHindsightClient{bankExists: true}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}
	record, err := executor.GetProfile(context.Background(), memoryruntime.ProfileQuery{
		TenantID: "tenant-main", OwnerUserID: "user-profile", OwnerGeneration: 2,
	})
	if err != nil {
		t.Fatalf("get profile: %v", err)
	}
	if record != (memoryruntime.ProfileRecord{Generating: true}) {
		t.Fatalf("record = %#v, want generating", record)
	}
	if client.createMentalModelCalls != 1 {
		t.Fatalf("create mental model calls = %d, want 1", client.createMentalModelCalls)
	}
	request := client.createdMentalModelReq
	if request.Name != "用户画像" || request.GetId() != hindsightProfileModelID {
		t.Fatalf("model name=%q id=%q", request.Name, request.GetId())
	}
	if request.SourceQuery != hindsightProfileSourceQuery {
		t.Fatalf("source query = %q", request.SourceQuery)
	}
	if request.GetMaxTokens() != hindsightProfileMaxTokens {
		t.Fatalf("max tokens = %d", request.GetMaxTokens())
	}
	trigger := request.GetTrigger()
	if trigger.GetMode() != "full" || !trigger.GetRefreshAfterConsolidation() {
		t.Fatalf("trigger = %#v", trigger)
	}
}

func TestHindsightGetProfileReturnsEmptyLocalRecordWithoutBank(t *testing.T) {
	client := &fakeHindsightClient{}
	executor := hindsightExecutor{client: client, ownerSalt: "test-salt"}
	record, err := executor.GetProfile(context.Background(), memoryruntime.ProfileQuery{
		TenantID: "tenant-main", OwnerUserID: "user-profile", OwnerGeneration: 1,
	})
	if err != nil {
		t.Fatalf("get profile: %v", err)
	}
	if record != (memoryruntime.ProfileRecord{}) {
		t.Fatalf("record = %#v, want empty", record)
	}
	if client.getMentalModelCalls != 0 || client.createMentalModelCalls != 0 {
		t.Fatalf("model calls get=%d create=%d, want 0/0", client.getMentalModelCalls, client.createMentalModelCalls)
	}
}

func TestHindsightGetProfileRejectsInvalidQuery(t *testing.T) {
	executor := hindsightExecutor{client: &fakeHindsightClient{}, ownerSalt: "test-salt"}
	if _, err := executor.GetProfile(context.Background(), memoryruntime.ProfileQuery{TenantID: "tenant-main"}); err == nil {
		t.Fatal("expected invalid profile query to be rejected")
	}
}
