package modelconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

func setProviderAuth(req *http.Request, provider, key string) {
	if provider == "google" {
		req.Header.Set("x-goog-api-key", key)
	} else {
		req.Header.Set("authorization", "Bearer "+key)
	}
}
func discoverGeminiModels(ctx context.Context, base, key string) ([]string, Validation) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	found := map[string]bool{}
	page := ""
	for {
		endpoint := base + "/models"
		if page != "" {
			endpoint += "?pageToken=" + url.QueryEscape(page)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, Validation{Status: "failed", ErrorCode: "invalid_setting", Message: "invalid Gemini endpoint"}
		}
		setProviderAuth(req, "google", key)
		response, err := client.Do(req)
		if err != nil {
			return nil, Validation{Status: "failed", ErrorCode: "provider_unavailable", Message: "Gemini model discovery failed"}
		}
		var body struct {
			Models        []struct{ Name string }
			NextPageToken string
		}
		err = json.NewDecoder(response.Body).Decode(&body)
		_ = response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, Validation{Status: "failed", ErrorCode: fmt.Sprintf("provider_http_%d", response.StatusCode), Message: "Gemini rejected model discovery"}
		}
		if err != nil || body.Models == nil {
			return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "invalid Gemini models response"}
		}
		for _, model := range body.Models {
			id := strings.TrimPrefix(strings.TrimSpace(model.Name), "models/")
			if id == "" || len(id) > 256 {
				return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "invalid Gemini model ID"}
			}
			found[id] = true
		}
		if body.NextPageToken == "" {
			break
		}
		page = body.NextPageToken
	}
	models := make([]string, 0, len(found))
	for id := range found {
		models = append(models, id)
	}
	sort.Strings(models)
	return models, Validation{Status: "passed", Message: "provider model discovery passed"}
}
