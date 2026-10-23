package hindsightadapter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProfileHTTPUsesRefreshStatusAndGeneratedContent(t *testing.T) {
	for _, tc := range []struct {
		name, status, content, generated string
		generating, wantError            bool
	}{
		{name: "pending placeholder", status: "pending", content: "Generating content...", generating: true},
		{name: "processing arbitrary placeholder", status: "processing", content: "任意占位正文", generating: true},
		{name: "refresh keeps previous profile", status: "processing", content: "已有画像", generated: "已有画像", generating: true},
		{name: "completed", status: "completed", content: "完整画像", generated: "完整画像"},
		{name: "completed without content", status: "completed", content: "Generating content..."},
		{name: "failed", status: "failed", content: "Generating content...", wantError: true},
		{name: "cancelled", status: "cancelled", wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var paths []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				paths = append(paths, r.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				if strings.HasSuffix(r.URL.Path, "/operations") {
					if r.URL.Query().Get("type") != "refresh_mental_model" {
						t.Error("missing operation type filter")
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"bank_id": "bank", "total": 2, "limit": 100, "offset": 0, "operations": []any{
						map[string]any{"id": "other", "task_type": "refresh_mental_model", "items_count": 0, "created_at": "2026-10-01T01:00:00Z", "status": "failed", "error_message": nil},
						map[string]any{"id": "refresh", "task_type": "refresh_mental_model", "items_count": 0, "created_at": "2026-10-01T00:00:00Z", "status": tc.status, "error_message": nil},
					}})
					return
				}
				if strings.Contains(r.URL.Path, "/operations/") {
					if r.URL.Query().Get("include_payload") != "true" {
						t.Error("task payload required")
					}
					id := "user-profile"
					if strings.HasSuffix(r.URL.Path, "/other") {
						id = "other-model"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"operation_id": "refresh", "status": tc.status, "task_payload": map[string]any{"mental_model_id": id}})
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "user-profile", "bank_id": "bank", "name": "用户画像", "content": tc.content, "last_refreshed_at": "2026-10-01T00:00:00Z", "is_stale": false, "reflect_response": map[string]any{"text": tc.generated}})
			}))
			defer server.Close()
			client := newHindsightHTTPClient(hindsightClientOptions{baseURL: server.URL, apiSecret: "test"})
			snapshot, found, err := client.GetMentalModel(context.Background(), "bank", "user-profile")
			if tc.wantError {
				if err == nil {
					t.Fatal("expected generation failure")
				}
				return
			}
			if err != nil || !found {
				t.Fatalf("found=%v err=%v", found, err)
			}
			if snapshot.Generating != tc.generating {
				t.Fatalf("generating=%v", snapshot.Generating)
			}
			wantContent := tc.content
			if tc.generated == "" {
				wantContent = ""
				if snapshot.LastRefreshedAt != "" {
					t.Fatal("placeholder has update timestamp")
				}
			}
			if snapshot.Content != wantContent {
				t.Fatalf("content=%q want=%q", snapshot.Content, wantContent)
			}
			if !strings.HasSuffix(paths[0], "/operations") {
				t.Fatal("must observe operation before reading committed content")
			}
		})
	}
}
