package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/modelconfig"
)

type ocrFakeStore struct {
	fakeStore
	expected time.Time
	recorded bool
}

func (s *ocrFakeStore) RecordOCRValidation(_ context.Context, expected time.Time, _ string, _ modelconfig.Validation) error {
	if !expected.Equal(s.expected) {
		return modelconfig.ErrConfigChanged
	}
	s.recorded = true
	return nil
}
func TestOCRSaveDoesNotCallProvider(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("save called OCR provider") }))
	defer provider.Close()
	store := &fakeStore{}
	server := New(store)
	request := httptest.NewRequest(http.MethodPut, "/internal/admin/model-configs/document_ocr", strings.NewReader(
		`{"provider":"paddleocr","api_protocol":"paddleocr.jobs","model":"PaddleOCR-VL-1.6","base_url":"`+provider.URL+`","api_key":"synthetic"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != 200 || store.putInput == nil {
		t.Fatalf("save failed: %d %s", recorder.Code, recorder.Body.String())
	}
}
func TestOCRRejectsStaleValidation(t *testing.T) {
	expected, _ := time.Parse(time.RFC3339Nano, "2026-01-01T00:00:00.123456Z")
	store := &ocrFakeStore{expected: expected}
	for _, tc := range []struct {
		at     string
		status int
	}{
		{"2026-01-01T00:00:00Z", 409},
		{"2026-01-01T00:00:00.123456Z", 200},
	} {
		request := httptest.NewRequest(http.MethodPost, "/internal/admin/model-configs/document_ocr/validation-result",
			strings.NewReader(`{"updated_at":"`+tc.at+`","validation":{"status":"passed","message":"parsed"}}`))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		New(store).ServeHTTP(recorder, request)
		if recorder.Code != tc.status {
			t.Fatalf("got %d, want %d", recorder.Code, tc.status)
		}
	}
	if !store.recorded {
		t.Fatal("current validation not recorded")
	}
}
