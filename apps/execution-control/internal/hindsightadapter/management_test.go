package hindsightadapter

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNativeMemoryManagementWireShapes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "GET /v1/default/banks/bank/memories/list":
			if r.URL.Query().Get("state") != "invalidated" || r.URL.Query().Get("type") != "world" || r.URL.Query().Get("q") != "偏好" {
				t.Errorf("query = %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"fact","text":"偏好","fact_type":"world","state":"invalidated","metadata":{"source":"manual"}}],"total":1,"limit":20,"offset":0}`))
		case "GET /v1/default/banks/bank/memories/summary":
			_, _ = w.Write([]byte(`{"id":"summary","text":"总结","type":"observation","state":"valid","source_memories":[{"id":"fact","text":"偏好","type":"world"}]}`))
		case "PATCH /v1/default/banks/bank/memories/fact":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["text"] != "新的偏好" || body["state"] != "invalidated" {
				t.Errorf("patch = %#v", body)
			}
			_, _ = w.Write([]byte(`{"success":true}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	c := newHindsightHTTPClient(hindsightClientOptions{baseURL: server.URL, apiSecret: "test"})
	page, err := c.ListMemories(context.Background(), "bank", memoryruntime.MemoryQuery{Limit: 20, State: "inactive", Kind: "fact", Query: "偏好"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].Kind != "fact" || page.Items[0].State != "inactive" || page.Items[0].Origin != "manual" {
		t.Fatalf("page = %#v", page)
	}
	summary, err := c.GetMemory(context.Background(), "bank", "summary")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Kind != "summary" || summary.Origin != "derived" || len(summary.SourceMemories) != 1 || summary.SourceMemories[0].MemoryID != "fact" {
		t.Fatalf("summary = %#v", summary)
	}
	if err = c.UpdateMemory(context.Background(), "bank", "fact", memoryruntime.PersonalMemoryCommandItem{Text: "新的偏好", State: "inactive"}); err != nil {
		t.Fatal(err)
	}
	if _, err = c.GetMemory(context.Background(), "bank", "missing"); !errors.Is(err, memoryruntime.ErrMemoryNotFound) {
		t.Fatalf("not found = %v", err)
	}
}
