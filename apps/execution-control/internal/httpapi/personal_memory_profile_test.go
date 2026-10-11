package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

type fakeProfileMemoryReader struct {
	profile    memoryruntime.ProfileRecord
	profileErr error
}

func (r fakeProfileMemoryReader) GetProfile(_ context.Context, _ memoryruntime.ProfileQuery) (memoryruntime.ProfileRecord, error) {
	return r.profile, r.profileErr
}

func newProfileServerForTest(reader *fakeProfileMemoryReader) *Server {
	server := newWorkerAuthServerForTest()
	server.personalMemoryReader = reader
	return server
}

func TestPersonalMemoryProfileGetReturnsRecord(t *testing.T) {
	server := newProfileServerForTest(&fakeProfileMemoryReader{
		profile: memoryruntime.ProfileRecord{Content: "用户偏好简洁回复", IsStale: true, LastRefreshedAt: "2026-09-24T00:00:00Z"},
	})
	request := newTestRequest(http.MethodPost, "/internal/memory/personal/profile/get", strings.NewReader(
		`{"tenant_id":"tenant-main","owner_user_id":"user-profile","owner_generation":1}`,
	))
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["content"] != "用户偏好简洁回复" || body["generating"] != false || body["is_stale"] != true || body["last_refreshed_at"] != "2026-09-24T00:00:00Z" {
		t.Fatalf("body = %#v", body)
	}
}

func TestPersonalMemoryProfileGetRejectsInvalidQuery(t *testing.T) {
	server := newProfileServerForTest(&fakeProfileMemoryReader{})
	request := newTestRequest(http.MethodPost, "/internal/memory/personal/profile/get", strings.NewReader(`{}`))
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertError(t, response, http.StatusBadRequest, "invalid_request")
}

func TestPersonalMemoryProfileGetRequiresWorkerAuth(t *testing.T) {
	server := newProfileServerForTest(&fakeProfileMemoryReader{})
	request := newTestRequest(http.MethodPost, "/internal/memory/personal/profile/get", strings.NewReader(
		`{"tenant_id":"tenant-main","owner_user_id":"user-profile","owner_generation":1}`,
	))
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertError(t, response, http.StatusUnauthorized, "unauthorized")
}

func TestPersonalMemoryProfileGetReportsLifecycleBlocked(t *testing.T) {
	server := newProfileServerForTest(&fakeProfileMemoryReader{
		profileErr: memoryruntime.ErrMemoryFenceConflict,
	})
	request := newTestRequest(http.MethodPost, "/internal/memory/personal/profile/get", strings.NewReader(
		`{"tenant_id":"tenant-main","owner_user_id":"user-profile","owner_generation":2}`,
	))
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertError(t, response, http.StatusConflict, "memory_lifecycle_blocked")
}

func TestPersonalMemoryProfileGetRequiresReader(t *testing.T) {
	server := newWorkerAuthServerForTest()
	request := newTestRequest(http.MethodPost, "/internal/memory/personal/profile/get", strings.NewReader(
		`{"tenant_id":"tenant-main","owner_user_id":"user-profile","owner_generation":1}`,
	))
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertError(t, response, http.StatusServiceUnavailable, "personal_memory_unavailable")
}
