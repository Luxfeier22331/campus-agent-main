package hindsightadapter

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestConfigUpgradeResumesFailedRefreshAndSkipsCurrentConfig(t *testing.T) {
	const bank = "hindsight_bank_0123456789abcdef0123456789abcdef"
	config := map[string]any{"unowned_setting": "keep"}
	model := map[string]any{"source_query": "old query", "max_tokens": 2048, "trigger": map[string]any{"mode": "full", "refresh_after_consolidation": true, "keep_trace": true}}
	bankPatches, modelPatches, refreshes := 0, 0, 0
	failed, oldWaited := true, false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") != "Bearer test" {
			t.Error("missing authentication")
		}
		write := func(v any) { _ = json.NewEncoder(w).Encode(v) }
		path := strings.TrimPrefix(r.URL.Path, "/v1/default/banks/"+bank)
		switch {
		case r.URL.Path == "/v1/default/banks":
			write(map[string]any{"banks": []any{map[string]any{"bank_id": bank, "name": "campus-agent personal memory"}, map[string]any{"bank_id": "unrelated", "name": "campus-agent personal memory"}, map[string]any{"bank_id": "hindsight_bank_ffffffffffffffffffffffffffffffff", "name": "another app"}}})
		case path == "/config" && r.Method == http.MethodGet:
			write(map[string]any{"config": config})
		case path == "/config" && r.Method == http.MethodPatch:
			var body struct {
				Updates map[string]any `json:"updates"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			for k, v := range body.Updates {
				config[k] = v
			}
			bankPatches++
			write(map[string]any{})
		case path == "/mental-models/user-profile" && r.Method == http.MethodGet:
			write(model)
		case path == "/mental-models/user-profile" && r.Method == http.MethodPatch:
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			for k, v := range body {
				model[k] = v
			}
			modelPatches++
			write(model)
		case path == "/operations":
			write(map[string]any{"total": 1, "operations": []any{map[string]any{"id": "old", "status": "processing"}}})
		case path == "/operations/old":
			if r.URL.Query().Get("include_payload") == "true" {
				write(map[string]any{"task_payload": map[string]any{"mental_model_id": "user-profile"}})
			} else {
				oldWaited = true
				write(map[string]any{"status": "completed"})
			}
		case path == "/mental-models/user-profile/refresh":
			if !oldWaited {
				t.Error("did not drain old refresh")
			}
			if model["trigger"].(map[string]any)["refresh_after_consolidation"] != false {
				t.Error("auto refresh enabled before success")
			}
			refreshes++
			write(map[string]any{"operation_id": "new"})
		case path == "/operations/new":
			status := "completed"
			if failed {
				status = "failed"
			}
			write(map[string]any{"status": status})
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	u := configUpgrader{client: newHindsightHTTPClient(hindsightClientOptions{baseURL: server.URL, apiSecret: "test"}), pollInterval: time.Millisecond, output: io.Discard}
	if err := u.run(context.Background()); err == nil {
		t.Fatal("failed refresh must fail upgrade")
	}
	if config["retain_mission"] != defaultHindsightBankConfig().RetainMission {
		t.Fatal("retain mission not written")
	}
	if config["unowned_setting"] != "keep" {
		t.Fatal("unowned configuration overwritten")
	}
	if model["trigger"].(map[string]any)["refresh_after_consolidation"] != false {
		t.Fatal("incomplete upgrade lost")
	}
	failed = false
	if err := u.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if model["source_query"] != hindsightProfileSourceQuery {
		t.Fatal("profile policy not applied")
	}
	if model["trigger"].(map[string]any)["keep_trace"] != true {
		t.Fatal("unknown trigger field lost")
	}
	patches := modelPatches
	if err := u.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if bankPatches != 1 || refreshes != 2 || modelPatches != patches {
		t.Fatalf("non-idempotent: bank=%d model=%d refresh=%d", bankPatches, modelPatches, refreshes)
	}
}

func TestConfigUpgradeDoesNotCreateMissingObjects(t *testing.T) {
	for _, missing := range []string{"/config", "/mental-models/user-profile"} {
		t.Run(missing, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet {
					t.Fatalf("unexpected write %s", r.Method)
				}
				w.Header().Set("Content-Type", "application/json")
				if strings.HasSuffix(r.URL.Path, "/banks") {
					_ = json.NewEncoder(w).Encode(map[string]any{"banks": []any{map[string]any{"bank_id": "hindsight_bank_0123456789abcdef0123456789abcdef", "name": "campus-agent personal memory"}}})
					return
				}
				if strings.HasSuffix(r.URL.Path, missing) {
					http.NotFound(w, r)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"config": hindsightBankConfigUpdate(defaultHindsightBankConfig())})
			}))
			defer server.Close()
			if err := UpgradeConfig(context.Background(), Options{BaseURL: server.URL, APISecret: "test"}, io.Discard); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestConfigUpgradeWaitHonorsDeadline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "processing"})
	}))
	defer server.Close()
	u := configUpgrader{client: newHindsightHTTPClient(hindsightClientOptions{baseURL: server.URL, apiSecret: "test"}), pollInterval: time.Hour, output: io.Discard}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := u.waitOperation(ctx, "/bank", "operation", true); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error=%v", err)
	}
}
