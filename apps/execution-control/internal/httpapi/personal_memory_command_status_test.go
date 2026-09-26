package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func TestPersonalMemoryCommandStatusRequiresAuthorizationAndOwnerScope(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	const ownerSalt = "test-owner-salt"
	const tenantID = "tenant-main"
	const userID = "user-memory-test"
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-transition",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          tenantID,
		UserID:            userID,
	}
	ownerHash := memoryruntime.OwnerScopeHash(ownerSalt, tenantID, userID)
	if _, _, err := state.BeginCommand(context.Background(), ownerHash, command, time.Minute); err != nil {
		t.Fatalf("seed command receipt: %v", err)
	}

	server := NewServerWithOptions(config.Config{
		AppAPIExecutionSharedSecret: "secret",
		PersonalMemoryOwnerSalt:     ownerSalt,
	}, ServerOptions{PersonalMemoryStateStore: state})

	requestStatusFor := func(commandID string, user string, auth string) *httptest.ResponseRecorder {
		t.Helper()
		request := newTestRequest(
			http.MethodPost,
			"/internal/memory/personal/commands/status",
			strings.NewReader(`{"command_id":"`+commandID+`","tenant_id":"tenant-main","user_id":"`+user+`"}`),
		)
		if auth != "" {
			request.Header.Set("x-worker-origin-auth", auth)
		}
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		return response
	}
	requestStatus := func(user string, auth string) *httptest.ResponseRecorder {
		return requestStatusFor("cmd-transition", user, auth)
	}

	unauthorized := requestStatus(userID, "")
	assertError(t, unauthorized, http.StatusUnauthorized, "unauthorized")

	wrongOwner := requestStatus("another-user", "secret")
	assertError(t, wrongOwner, http.StatusNotFound, "command_not_found")

	missing := requestStatusFor("missing-command", userID, "secret")
	assertError(t, missing, http.StatusNotFound, "command_not_found")

	status := requestStatus(userID, "secret")
	if status.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", status.Code, status.Body.String())
	}
	body := decodeBody(t, status)
	if body["command_id"] != "cmd-transition" || body["status"] != "processing" {
		t.Fatalf("status body = %#v, want command and processing status", body)
	}
	if body["stale"] != false {
		t.Fatalf("status body stale = %#v, want false for a fresh receipt", body["stale"])
	}

	// An untouched receipt beyond the stale margin reports stale so admission
	// can restart its dead workflow.
	state.ShiftReceiptClockForTest(command.CommandID, -(memoryruntime.CommandReceiptStaleAfter + time.Minute))
	staleStatus := requestStatus(userID, "secret")
	if staleStatus.Code != http.StatusOK {
		t.Fatalf("stale status = %d, want 200; body: %s", staleStatus.Code, staleStatus.Body.String())
	}
	staleBody := decodeBody(t, staleStatus)
	if staleBody["stale"] != true {
		t.Fatalf("stale status body = %#v, want stale=true", staleBody)
	}
}

func TestPersonalMemoryCommandStatusReturnsUnavailableWhenStateStoreIsNotReady(t *testing.T) {
	server := NewServerWithOptions(config.Config{
		AppAPIExecutionSharedSecret: "secret",
		PersonalMemoryOwnerSalt:     "test-owner-salt",
	}, ServerOptions{PersonalMemoryStateError: context.Canceled})
	request := newTestRequest(
		http.MethodPost,
		"/internal/memory/personal/commands/status",
		strings.NewReader(`{"command_id":"cmd-transition","tenant_id":"tenant-main","user_id":"user-memory-test"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertError(t, response, http.StatusServiceUnavailable, "personal_memory_unavailable")
}
