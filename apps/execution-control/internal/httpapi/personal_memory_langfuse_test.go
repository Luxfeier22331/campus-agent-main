package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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
		if !ok || username != "pk-memory" || password != "sk-memory" {
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

	_, maintenance, err := newLangfuseTraceMaintenance(config.Config{
		LangfuseMaintenanceBaseURL:            server.URL,
		LangfuseRuntimeMaintenancePublicKey:   "pk-runtime",
		LangfuseRuntimeMaintenanceSecretKey:   "sk-runtime",
		LangfuseHindsightMaintenancePublicKey: "pk-memory",
		LangfuseHindsightMaintenanceSecretKey: "sk-memory",
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

func TestLangfuseTraceMaintenanceSanitizesServerFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusInternalServerError)
		_, _ = response.Write([]byte("provider-secret-and-user-content"))
	}))
	defer server.Close()
	_, maintenance, err := newLangfuseTraceMaintenance(config.Config{
		LangfuseMaintenanceBaseURL:            server.URL,
		LangfuseRuntimeMaintenancePublicKey:   "pk-runtime",
		LangfuseRuntimeMaintenanceSecretKey:   "sk-runtime",
		LangfuseHindsightMaintenancePublicKey: "pk-memory",
		LangfuseHindsightMaintenanceSecretKey: "sk-memory",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = maintenance.CountUserTraces(context.Background(), "hindsight_bank_scoped")
	if err == nil || strings.Contains(err.Error(), "provider-secret") || strings.Contains(err.Error(), "sk-memory") {
		t.Fatalf("sanitized error = %v", err)
	}
}

func TestLangfuseTraceMaintenanceScopesRetentionToEachProjectKey(t *testing.T) {
	cutoff := time.Date(2026, 7, 10, 3, 0, 0, 123, time.UTC)
	deleted := map[string][]string{}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		publicKey, secretKey, ok := request.BasicAuth()
		if !ok || secretKey != "sk-"+strings.TrimPrefix(publicKey, "pk-") {
			t.Fatalf("unexpected basic auth %q %q", publicKey, secretKey)
		}
		project := strings.TrimPrefix(publicKey, "pk-")
		switch request.Method {
		case http.MethodGet:
			query := request.URL.Query()
			if query.Get("toTimestamp") != cutoff.Format(time.RFC3339Nano) ||
				query.Get("userId") != "" || query.Get("fields") != "core" ||
				query.Get("orderBy") != "timestamp.asc" {
				t.Fatalf("retention query = %q", request.URL.RawQuery)
			}
			_, _ = response.Write([]byte(`{"data":[{"id":"trace-` + project + `"}],"meta":{"page":1,"limit":100,"totalItems":1,"totalPages":1}}`))
		case http.MethodDelete:
			var body struct {
				TraceIDs []string `json:"traceIds"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			deleted[project] = append(deleted[project], body.TraceIDs...)
		default:
			t.Fatalf("unexpected method %s", request.Method)
		}
	}))
	defer server.Close()

	runtimeStore, hindsightStore, err := newLangfuseTraceMaintenance(config.Config{
		LangfuseMaintenanceBaseURL:            server.URL,
		LangfuseRuntimeMaintenancePublicKey:   "pk-runtime",
		LangfuseRuntimeMaintenanceSecretKey:   "sk-runtime",
		LangfuseHindsightMaintenancePublicKey: "pk-hindsight",
		LangfuseHindsightMaintenanceSecretKey: "sk-hindsight",
	})
	if err != nil {
		t.Fatal(err)
	}
	if count, err := runtimeStore.PurgeTracesBefore(context.Background(), cutoff); err != nil || count != 1 {
		t.Fatalf("runtime purge count=%d error=%v", count, err)
	}
	if count, err := hindsightStore.PurgeTracesBefore(context.Background(), cutoff); err != nil || count != 1 {
		t.Fatalf("hindsight purge count=%d error=%v", count, err)
	}
	if len(deleted["runtime"]) != 1 || deleted["runtime"][0] != "trace-runtime" ||
		len(deleted["hindsight"]) != 1 || deleted["hindsight"][0] != "trace-hindsight" {
		t.Fatalf("deleted traces = %#v", deleted)
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
	_, err = client.PurgeTracesBefore(context.Background(), time.Now().UTC())
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
			if _, err := client.CountTracesBefore(context.Background(), time.Now().UTC()); err == nil || !strings.Contains(err.Error(), "response contract") {
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
	if _, err := client.CountTracesBefore(context.Background(), time.Now().UTC()); err == nil || !strings.Contains(err.Error(), "pagination metadata") {
		t.Fatalf("error = %v", err)
	}
}

type fakePersonalMemoryTraceMaintenance struct {
	count           int
	deleted         int
	lastCutoff      time.Time
	lastUserID      string
	purgeErr        error
	verificationErr error
}

func (f *fakePersonalMemoryTraceMaintenance) PurgeUserTraces(_ context.Context, userID string) (int, error) {
	f.lastUserID = userID
	return f.deleted, f.purgeErr
}

func (f *fakePersonalMemoryTraceMaintenance) CountUserTraces(_ context.Context, userID string) (int, error) {
	f.lastUserID = userID
	return f.count, f.verificationErr
}

func (f *fakePersonalMemoryTraceMaintenance) PurgeUserTracesBefore(
	_ context.Context,
	userID string,
	cutoff time.Time,
) (int, error) {
	f.lastUserID = userID
	f.lastCutoff = cutoff
	return f.deleted, f.purgeErr
}

func (f *fakePersonalMemoryTraceMaintenance) CountUserTracesBefore(
	_ context.Context,
	userID string,
	cutoff time.Time,
) (int, error) {
	f.lastUserID = userID
	f.lastCutoff = cutoff
	return f.count, f.verificationErr
}

func (f *fakePersonalMemoryTraceMaintenance) PurgeTracesBefore(_ context.Context, cutoff time.Time) (int, error) {
	f.lastCutoff = cutoff
	return f.deleted, f.purgeErr
}

func (f *fakePersonalMemoryTraceMaintenance) CountTracesBefore(_ context.Context, cutoff time.Time) (int, error) {
	f.lastCutoff = cutoff
	return f.count, f.verificationErr
}

func TestPersonalMemoryTraceActivitiesUseTheRetiredSaltedBankID(t *testing.T) {
	runtimeMaintenance := &fakePersonalMemoryTraceMaintenance{deleted: 2}
	hindsightMaintenance := &fakePersonalMemoryTraceMaintenance{deleted: 3}
	server := &Server{
		config:                   config.Config{PersonalMemoryOwnerSalt: "owner-salt"},
		runtimeTraceStore:        runtimeMaintenance,
		personalMemoryTraceStore: hindsightMaintenance,
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
	if result.DeletedTraceCount != 5 ||
		runtimeMaintenance.lastUserID != "user-1" ||
		!runtimeMaintenance.lastCutoff.Equal(wantCutoff) ||
		hindsightMaintenance.lastUserID != wantUserID {
		t.Fatalf(
			"result=%#v runtimeUserID=%q runtimeCutoff=%s hindsightUserID=%q want=%q",
			result,
			runtimeMaintenance.lastUserID,
			runtimeMaintenance.lastCutoff,
			hindsightMaintenance.lastUserID,
			wantUserID,
		)
	}
	runtimeMaintenance.count = 1
	hindsightMaintenance.count = 2
	verification, err := server.VerifyPersonalMemoryTracesActivity(
		context.Background(),
		temporalruntime.PersonalMemoryTraceMaintenanceActivityInput{Command: command},
	)
	if err != nil {
		t.Fatal(err)
	}
	if verification.RemainingTraceCount != 3 {
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
		name      string
		runtime   *fakePersonalMemoryTraceMaintenance
		hindsight *fakePersonalMemoryTraceMaintenance
		verify    bool
		errorType string
	}{
		{
			name:      "runtime purge",
			runtime:   &fakePersonalMemoryTraceMaintenance{purgeErr: errors.New("runtime failed")},
			hindsight: &fakePersonalMemoryTraceMaintenance{},
			errorType: "personal_memory_runtime_trace_purge_failed",
		},
		{
			name:      "Hindsight purge",
			runtime:   &fakePersonalMemoryTraceMaintenance{},
			hindsight: &fakePersonalMemoryTraceMaintenance{purgeErr: errors.New("Hindsight failed")},
			errorType: "personal_memory_hindsight_trace_purge_failed",
		},
		{
			name:      "runtime verify",
			runtime:   &fakePersonalMemoryTraceMaintenance{verificationErr: errors.New("runtime failed")},
			hindsight: &fakePersonalMemoryTraceMaintenance{},
			verify:    true,
			errorType: "personal_memory_runtime_trace_verify_failed",
		},
		{
			name:      "Hindsight verify",
			runtime:   &fakePersonalMemoryTraceMaintenance{},
			hindsight: &fakePersonalMemoryTraceMaintenance{verificationErr: errors.New("Hindsight failed")},
			verify:    true,
			errorType: "personal_memory_hindsight_trace_verify_failed",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			server := &Server{
				config:                   config.Config{PersonalMemoryOwnerSalt: "owner-salt"},
				runtimeTraceStore:        testCase.runtime,
				personalMemoryTraceStore: testCase.hindsight,
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
