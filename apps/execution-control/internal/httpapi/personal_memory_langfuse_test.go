package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/temporal"
)

func TestLangfuseTraceMaintenancePurgesOnlyTheRequestedUser(t *testing.T) {
	deleted := map[string]bool{}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		username, password, ok := request.BasicAuth()
		if !ok || username != "pk-staging" || password != "sk-staging" {
			t.Fatalf("basic auth = %q %q %t", username, password, ok)
		}
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/public/traces":
			if request.URL.Query().Get("userId") != "hindsight_bank_scoped" || request.URL.Query().Get("page") != "1" {
				t.Fatalf("trace query = %q", request.URL.RawQuery)
			}
			response.Header().Set("content-type", "application/json")
			_, _ = response.Write([]byte(`{"data":[{"id":"trace-1"},{"id":"trace-2"}],"meta":{"page":1,"limit":100,"totalItems":2,"totalPages":1}}`))
		case request.Method == http.MethodDelete && request.URL.Path == "/api/public/traces":
			var body struct {
				TraceIDs []string `json:"traceIds"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			for _, traceID := range body.TraceIDs {
				deleted[traceID] = true
			}
			response.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
	}))
	defer server.Close()

	maintenance, err := newLangfuseTraceMaintenance(config.Config{
		LangfuseBaseURL:   server.URL,
		LangfusePublicKey: "pk-staging",
		LangfuseSecretKey: "sk-staging",
	})
	if err != nil {
		t.Fatal(err)
	}
	count, err := maintenance.PurgeUserTraces(context.Background(), "hindsight_bank_scoped")
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 || !deleted["trace-1"] || !deleted["trace-2"] {
		t.Fatalf("deleted count=%d ids=%#v", count, deleted)
	}
}

func TestLangfuseTraceMaintenanceBoundsStableUserDeletionAtEraseTime(t *testing.T) {
	cutoff := time.Date(2026, 7, 16, 0, 0, 0, 123, time.UTC)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		query := request.URL.Query()
		if request.Method != http.MethodGet ||
			query.Get("userId") != "user-1" ||
			query.Get("toTimestamp") != cutoff.Format(time.RFC3339Nano) {
			t.Fatalf("trace query = %s %q", request.Method, request.URL.RawQuery)
		}
		_, _ = response.Write([]byte(`{"data":[],"meta":{"page":1,"limit":1,"totalItems":0,"totalPages":0}}`))
	}))
	defer server.Close()
	client, err := newLangfuseTraceMaintenanceClient(server.URL, "pk-runtime", "sk-runtime")
	if err != nil {
		t.Fatal(err)
	}
	count, err := client.CountUserTracesBefore(context.Background(), "user-1", cutoff)
	if err != nil || count != 0 {
		t.Fatalf("count=%d error=%v", count, err)
	}
}

func TestLangfuseTraceMaintenanceRequiresAnOriginBaseURL(t *testing.T) {
	for _, value := range []string{
		"https://langfuse.example/api",
		"https://langfuse.example?tenant=one",
		"https://langfuse.example#fragment",
		"https://user:password@langfuse.example",
	} {
		t.Run(value, func(t *testing.T) {
			if _, err := newLangfuseTraceMaintenanceClient(value, "pk-runtime", "sk-runtime"); err == nil || !strings.Contains(err.Error(), "must be an http(s) origin") {
				t.Fatalf("error = %v", err)
			}
		})
	}
	client, err := newLangfuseTraceMaintenanceClient(
		"https://langfuse.example/",
		"pk-runtime",
		"sk-runtime",
	)
	if err != nil || client.baseURL.String() != "https://langfuse.example" {
		t.Fatalf("client=%#v error=%v", client, err)
	}
}

func TestLangfuseTraceMaintenanceDoesNotFollowRedirects(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		location func(targetURL string) string
	}{
		{
			name: "same origin",
			location: func(_ string) string {
				return "/redirect-target"
			},
		},
		{
			name: "cross origin",
			location: func(targetURL string) string {
				return targetURL
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			var targetRequests atomic.Int32
			target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				targetRequests.Add(1)
				response.WriteHeader(http.StatusOK)
			}))
			defer target.Close()

			source := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.URL.Path == "/redirect-target" {
					targetRequests.Add(1)
					response.WriteHeader(http.StatusOK)
					return
				}
				response.Header().Set("location", testCase.location(target.URL))
				response.WriteHeader(http.StatusTemporaryRedirect)
			}))
			defer source.Close()

			client, err := newLangfuseTraceMaintenanceClient(source.URL, "pk-runtime", "sk-runtime")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := client.CountUserTraces(context.Background(), "user-1"); err == nil {
				t.Fatal("Langfuse trace count succeeded through redirect")
			}
			if got := targetRequests.Load(); got != 0 {
				t.Fatalf("redirect target received %d requests, want 0", got)
			}
		})
	}
}

func TestLangfuseTraceMaintenanceSanitizesServerFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusInternalServerError)
		_, _ = response.Write([]byte("provider-secret-and-user-content"))
	}))
	defer server.Close()
	maintenance, err := newLangfuseTraceMaintenance(config.Config{
		LangfuseBaseURL:   server.URL,
		LangfusePublicKey: "pk-staging",
		LangfuseSecretKey: "sk-staging",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = maintenance.CountUserTraces(context.Background(), "hindsight_bank_scoped")
	if err == nil || strings.Contains(err.Error(), "provider-secret") || strings.Contains(err.Error(), "sk-staging") {
		t.Fatalf("sanitized error = %v", err)
	}
}

func TestLangfuseTraceMaintenanceRejectsUnboundedPagination(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"data":[{"id":"trace-1"}],"meta":{"page":1,"limit":100,"totalItems":100001,"totalPages":1001}}`))
	}))
	defer server.Close()
	client, err := newLangfuseTraceMaintenanceClient(server.URL, "pk-runtime", "sk-runtime")
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.PurgeUserTraces(context.Background(), "user-1")
	if err == nil || !strings.Contains(err.Error(), "bounded pagination") {
		t.Fatalf("error = %v", err)
	}
}

func TestLangfuseTraceMaintenanceRejectsIncompleteSuccessfulResponses(t *testing.T) {
	validMeta := `"meta":{"page":1,"limit":1,"totalItems":0,"totalPages":0}`
	for _, testCase := range []struct {
		name string
		body string
	}{
		{name: "empty object", body: `{}`},
		{name: "missing data", body: `{` + validMeta + `}`},
		{name: "null data", body: `{"data":null,` + validMeta + `}`},
		{name: "missing meta", body: `{"data":[]}`},
		{name: "partial meta", body: `{"data":[],"meta":{"page":1,"limit":1}}`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("content-type", "application/json")
				_, _ = response.Write([]byte(testCase.body))
			}))
			defer server.Close()
			client, err := newLangfuseTraceMaintenanceClient(server.URL, "pk-runtime", "sk-runtime")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := client.CountUserTraces(context.Background(), "user-1"); err == nil || !strings.Contains(err.Error(), "response contract") {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestLangfuseTraceMaintenanceRejectsInconsistentPaginationMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"data":[],"meta":{"page":2,"limit":1,"totalItems":0,"totalPages":0}}`))
	}))
	defer server.Close()
	client, err := newLangfuseTraceMaintenanceClient(server.URL, "pk-runtime", "sk-runtime")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.CountUserTraces(context.Background(), "user-1"); err == nil || !strings.Contains(err.Error(), "pagination metadata") {
		t.Fatalf("error = %v", err)
	}
}

type fakePersonalMemoryTraceMaintenance struct {
	count           int
	deleted         int
	countUserCalls  int
	countUserErrors []error
	lastCutoff      time.Time
	lastUserID      string
	purgeErr        error
	purgeUserCalls  int
	purgeUserErrors []error
	userIDs         []string
	verificationErr error
}

func (f *fakePersonalMemoryTraceMaintenance) PurgeUserTraces(_ context.Context, userID string) (int, error) {
	f.lastUserID = userID
	f.userIDs = append(f.userIDs, userID)
	err := errorAt(f.purgeUserErrors, f.purgeUserCalls, f.purgeErr)
	f.purgeUserCalls++
	return f.deleted, err
}

func (f *fakePersonalMemoryTraceMaintenance) CountUserTraces(_ context.Context, userID string) (int, error) {
	f.lastUserID = userID
	f.userIDs = append(f.userIDs, userID)
	err := errorAt(f.countUserErrors, f.countUserCalls, f.verificationErr)
	f.countUserCalls++
	return f.count, err
}

func (f *fakePersonalMemoryTraceMaintenance) PurgeUserTracesBefore(
	_ context.Context,
	userID string,
	cutoff time.Time,
) (int, error) {
	f.lastUserID = userID
	f.lastCutoff = cutoff
	f.userIDs = append(f.userIDs, userID)
	err := errorAt(f.purgeUserErrors, f.purgeUserCalls, f.purgeErr)
	f.purgeUserCalls++
	return f.deleted, err
}

func (f *fakePersonalMemoryTraceMaintenance) CountUserTracesBefore(
	_ context.Context,
	userID string,
	cutoff time.Time,
) (int, error) {
	f.lastUserID = userID
	f.lastCutoff = cutoff
	f.userIDs = append(f.userIDs, userID)
	err := errorAt(f.countUserErrors, f.countUserCalls, f.verificationErr)
	f.countUserCalls++
	return f.count, err
}

func errorAt(errors []error, index int, fallback error) error {
	if index < len(errors) {
		return errors[index]
	}
	return fallback
}

func TestPersonalMemoryTraceActivitiesUseTheRetiredSaltedBankID(t *testing.T) {
	maintenance := &fakePersonalMemoryTraceMaintenance{deleted: 2}
	server := &Server{
		config:             config.Config{PersonalMemoryOwnerSalt: "owner-salt"},
		langfuseTraceStore: maintenance,
	}
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-erase",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	result, err := server.PurgePersonalMemoryTracesActivity(
		context.Background(),
		temporalruntime.PersonalMemoryTraceMaintenanceActivityInput{Command: command},
	)
	if err != nil {
		t.Fatal(err)
	}
	wantUserID := scopedHindsightBankID("owner-salt", "tenant-main", "user-1", 1)
	wantCutoff := time.Date(2026, 7, 16, 0, 0, 0, 0, time.UTC)
	if result.DeletedTraceCount != 4 ||
		len(maintenance.userIDs) != 2 ||
		maintenance.userIDs[0] != "user-1" ||
		maintenance.userIDs[1] != wantUserID ||
		!maintenance.lastCutoff.Equal(wantCutoff) {
		t.Fatalf(
			"result=%#v userIDs=%q cutoff=%s wantBank=%q",
			result,
			maintenance.userIDs,
			maintenance.lastCutoff,
			wantUserID,
		)
	}
	maintenance.count = 1
	maintenance.userIDs = nil
	verification, err := server.VerifyPersonalMemoryTracesActivity(
		context.Background(),
		temporalruntime.PersonalMemoryTraceMaintenanceActivityInput{Command: command},
	)
	if err != nil {
		t.Fatal(err)
	}
	if verification.RemainingTraceCount != 2 || len(maintenance.userIDs) != 2 {
		t.Fatalf("verification = %#v", verification)
	}
}

func TestPersonalMemoryTraceActivityFailsClosedWhenMaintenanceIsMissing(t *testing.T) {
	server := &Server{config: config.Config{PersonalMemoryOwnerSalt: "owner-salt"}}
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-erase",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	_, err := server.PurgePersonalMemoryTracesActivity(
		context.Background(),
		temporalruntime.PersonalMemoryTraceMaintenanceActivityInput{Command: command},
	)
	var applicationError *temporal.ApplicationError
	if !errors.As(err, &applicationError) || applicationError.Type() != "memory_trace_maintenance_not_configured" || applicationError.NonRetryable() {
		t.Fatalf("error = %v", err)
	}
}

func TestPersonalMemoryTraceActivitiesDistinguishProjectFailures(t *testing.T) {
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-erase",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	input := temporalruntime.PersonalMemoryTraceMaintenanceActivityInput{Command: command}
	for _, testCase := range []struct {
		name        string
		maintenance *fakePersonalMemoryTraceMaintenance
		verify      bool
		errorType   string
	}{
		{
			name:        "runtime purge",
			maintenance: &fakePersonalMemoryTraceMaintenance{purgeUserErrors: []error{errors.New("runtime failed")}},
			errorType:   "personal_memory_runtime_trace_purge_failed",
		},
		{
			name:        "Hindsight purge",
			maintenance: &fakePersonalMemoryTraceMaintenance{purgeUserErrors: []error{nil, errors.New("Hindsight failed")}},
			errorType:   "personal_memory_hindsight_trace_purge_failed",
		},
		{
			name:        "runtime verify",
			maintenance: &fakePersonalMemoryTraceMaintenance{countUserErrors: []error{errors.New("runtime failed")}},
			verify:      true,
			errorType:   "personal_memory_runtime_trace_verify_failed",
		},
		{
			name:        "Hindsight verify",
			maintenance: &fakePersonalMemoryTraceMaintenance{countUserErrors: []error{nil, errors.New("Hindsight failed")}},
			verify:      true,
			errorType:   "personal_memory_hindsight_trace_verify_failed",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			server := &Server{
				config:             config.Config{PersonalMemoryOwnerSalt: "owner-salt"},
				langfuseTraceStore: testCase.maintenance,
			}
			var err error
			if testCase.verify {
				_, err = server.VerifyPersonalMemoryTracesActivity(context.Background(), input)
			} else {
				_, err = server.PurgePersonalMemoryTracesActivity(context.Background(), input)
			}
			var applicationError *temporal.ApplicationError
			if !errors.As(err, &applicationError) || applicationError.Type() != testCase.errorType {
				t.Fatalf("error = %v, want type %s", err, testCase.errorType)
			}
		})
	}
}

var _ langfuseTraceMaintenance = (*fakePersonalMemoryTraceMaintenance)(nil)
