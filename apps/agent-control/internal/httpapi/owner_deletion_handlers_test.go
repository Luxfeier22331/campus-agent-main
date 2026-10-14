package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
)

type deletionStoreStub struct {
	calls                 *[]string
	status                execution.OwnerDeletionStatus
	beginErr, finalizeErr error
}

func (s deletionStoreStub) BeginOwnerDeletion(_ context.Context, owner string, _ time.Time) (execution.OwnerDeletionStatus, error) {
	*s.calls = append(*s.calls, "begin:"+owner)
	return s.status, s.beginErr
}
func (s deletionStoreStub) FinalizeOwnerDeletion(_ context.Context, request execution.OwnerDeletionFinalizeRequest) (execution.OwnerDeletionStatus, error) {
	*s.calls = append(*s.calls, "finalize:"+request.OwnerUserID)
	if s.finalizeErr != nil {
		return s.status, s.finalizeErr
	}
	return execution.OwnerDeletionStatus{OwnerUserID: request.OwnerUserID, State: execution.OwnerDeletionStateDeleted}, nil
}

func TestOwnerDeletionPreservesOrderingAndHTTPResults(t *testing.T) {
	const owner = "user-delete"
	begin := "begin:" + owner
	finalize := "finalize:" + owner
	failed := errors.New("store failed")
	for _, tc := range []struct {
		name                             string
		state                            execution.OwnerDeletionState
		active                           int
		beginErr, memoryErr, finalizeErr error
		unavailableMemory, missingSalt   bool
		wantCode                         int
		wantError                        string
		wantCalls                        []string
	}{
		{name: "success", wantCode: 200, wantCalls: []string{begin, finalize}},
		{name: "already deleted", state: execution.OwnerDeletionStateDeleted, unavailableMemory: true, wantCode: 200, wantCalls: []string{begin}},
		{name: "active execution", active: 1, unavailableMemory: true, wantCode: 409, wantCalls: []string{begin}},
		{name: "begin failed", beginErr: failed, wantCode: 500, wantError: "owner_deletion_begin_failed", wantCalls: []string{begin}},
		{name: "begin drain error retains phase", beginErr: execution.ErrOwnerDeletionNotDrained, wantCode: 500, wantError: "owner_deletion_begin_failed", wantCalls: []string{begin}},
		{name: "finalize not drained", finalizeErr: execution.ErrOwnerDeletionNotDrained, wantCode: 409, wantCalls: []string{begin, finalize}},
		{name: "finalize not started", finalizeErr: execution.ErrOwnerDeletionNotStarted, wantCode: 404, wantError: "owner_deletion_not_started", wantCalls: []string{begin, finalize}},
		{name: "finalize failed", finalizeErr: failed, wantCode: 500, wantError: "owner_deletion_finalize_failed", wantCalls: []string{begin, finalize}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls []string
			state := tc.state
			if state == "" {
				state = execution.OwnerDeletionStateDraining
			}
			store := deletionStoreStub{calls: &calls, status: execution.OwnerDeletionStatus{OwnerUserID: owner, State: state, ActiveRuns: tc.active}, beginErr: tc.beginErr, finalizeErr: tc.finalizeErr}
			service := executionapplication.NewOwnerDeletionService(executionapplication.OwnerDeletionOptions{Store: store})
			server := NewServerWithOptions(config.Config{IngressSharedSecret: "secret", AppAPIInternalSharedSecret: "secret"}, ServerOptions{OwnerDeletion: service})
			request := newTestRequest(http.MethodPost, "/internal/owners/"+owner+"/deletion/finalize", strings.NewReader(`{"memory_erased":true}`))
			request.Header.Set("x-worker-origin-auth", "secret")
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			if tc.wantError != "" {
				assertError(t, response, tc.wantCode, tc.wantError)
			} else {
				if response.Code != tc.wantCode {
					t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
				}
				body := decodeBody(t, response)
				wantState := state
				if tc.wantCode == 200 {
					wantState = execution.OwnerDeletionStateDeleted
				}
				if body["owner_user_id"] != owner || body["state"] != string(wantState) || body["active_run_count"] != float64(tc.active) {
					t.Fatalf("body=%v", body)
				}
			}
			if !reflect.DeepEqual(calls, tc.wantCalls) {
				t.Fatalf("calls=%v want=%v", calls, tc.wantCalls)
			}
		})
	}
}

func TestOwnerDeletionHTTPValidationPrecedesSideEffects(t *testing.T) {
	for _, tc := range []struct {
		name, action, body, auth string
		unavailable              bool
		want                     int
		code                     string
	}{
		{name: "unauthorized", action: "finalize", body: `{"memory_erased":true}`, want: 401, code: "unauthorized"},
		{name: "store unavailable", action: "finalize", body: `{}`, auth: "secret", unavailable: true, want: 503, code: "projection_store_not_configured"},
		{name: "erase confirmation missing", action: "finalize", body: `{}`, auth: "secret", want: 400, code: "invalid_request"},
		{name: "erase confirmation false", action: "finalize", body: `{"memory_erased":false}`, auth: "secret", want: 400, code: "invalid_request"},
		{name: "begin", action: "begin", auth: "secret", want: 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls []string
			opts := executionapplication.OwnerDeletionOptions{Store: deletionStoreStub{calls: &calls}}
			if tc.unavailable {
				opts.StoreError = errors.New("unavailable")
			}
			server := NewServerWithOptions(config.Config{IngressSharedSecret: "secret", AppAPIInternalSharedSecret: "secret"}, ServerOptions{OwnerDeletion: executionapplication.NewOwnerDeletionService(opts)})
			request := newTestRequest(http.MethodPost, "/internal/owners/user/deletion/"+tc.action, strings.NewReader(tc.body))
			request.Header.Set("x-worker-origin-auth", tc.auth)
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			if tc.code != "" {
				assertError(t, response, tc.want, tc.code)
			} else if response.Code != tc.want {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if tc.action == "begin" {
				if !reflect.DeepEqual(calls, []string{"begin:user"}) {
					t.Fatalf("calls=%v", calls)
				}
			} else if len(calls) != 0 {
				t.Fatalf("unexpected side effects: %v", calls)
			}
		})
	}
}
