package providerconfig

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const ValidationTimeout = 10 * time.Second

func Validate(ctx context.Context, setting RuntimeSetting) ValidationResult {
	if err := validateSettingShape(setting); err != nil {
		return ValidationResult{ErrorCode: "invalid_setting", Message: err.Error(), Status: "failed"}
	}
	validationCtx, cancel := context.WithTimeout(ctx, ValidationTimeout)
	defer cancel()
	client := &http.Client{Timeout: ValidationTimeout}
	switch setting.Kind {
	case KindLLM:
		return validateLLM(validationCtx, client, setting)
	case KindEmbedding:
		return validateEmbedding(validationCtx, client, setting)
	default:
		return ValidationResult{ErrorCode: "unsupported_kind", Message: "model setting kind is unsupported", Status: "failed"}
	}
}

func validateSettingShape(setting RuntimeSetting) error {
	if strings.TrimSpace(setting.APIKey) == "" || strings.TrimSpace(setting.BaseURL) == "" || strings.TrimSpace(setting.Model) == "" {
		return errors.New("api key, base url, and model are required")
	}
	parsed, err := url.Parse(setting.BaseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return errors.New("provider base url must be an absolute HTTP(S) URL")
	}
	if parsed.Scheme == "http" && parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" {
		return errors.New("provider base url must use HTTPS outside loopback")
	}
	if setting.Provider != "openai" && setting.Provider != "openai-compatible" {
		return errors.New("provider must be openai or openai-compatible")
	}
	if setting.Kind == KindEmbedding && setting.Dimensions <= 0 {
		return errors.New("embedding dimensions must be positive")
	}
	if setting.Kind == KindEmbedding && setting.Transport != "embeddings" {
		return errors.New("embedding transport must be embeddings")
	}
	if setting.Kind == KindLLM && setting.Transport != "responses" && setting.Transport != "chat_completions" {
		return errors.New("llm transport must be responses or chat_completions")
	}
	return nil
}

func validateLLM(ctx context.Context, client *http.Client, setting RuntimeSetting) ValidationResult {
	path := "/responses"
	payload := map[string]any{
		"input": "Return OK.", "max_output_tokens": 8, "model": setting.Model,
	}
	if setting.Transport == "chat_completions" {
		path = "/chat/completions"
		payload = map[string]any{
			"max_tokens": 8,
			"messages":   []map[string]string{{"role": "user", "content": "Return OK."}},
			"model":      setting.Model,
		}
	}
	result, err := callProvider(ctx, client, setting, path, payload)
	if err != nil {
		return failedValidation(err)
	}
	if setting.Transport == "chat_completions" {
		if result["choices"] == nil {
			return ValidationResult{ErrorCode: "invalid_response", Message: "provider response is missing choices", Status: "failed"}
		}
	} else if result["id"] == nil && result["output"] == nil {
		return ValidationResult{ErrorCode: "invalid_response", Message: "provider response is missing output", Status: "failed"}
	}
	return ValidationResult{Message: "llm provider validation passed", Status: "passed"}
}

func validateEmbedding(ctx context.Context, client *http.Client, setting RuntimeSetting) ValidationResult {
	result, err := callProvider(ctx, client, setting, "/embeddings", map[string]any{
		"dimensions": setting.Dimensions,
		"input":      "campus-agent provider validation",
		"model":      setting.Model,
	})
	if err != nil {
		return failedValidation(err)
	}
	data, ok := result["data"].([]any)
	if !ok || len(data) == 0 {
		return ValidationResult{ErrorCode: "invalid_response", Message: "embedding response is missing data", Status: "failed"}
	}
	item, _ := data[0].(map[string]any)
	embedding, _ := item["embedding"].([]any)
	if len(embedding) != setting.Dimensions {
		return ValidationResult{
			ErrorCode:          "dimension_mismatch",
			Message:            fmt.Sprintf("embedding dimensions = %d, want %d", len(embedding), setting.Dimensions),
			ObservedDimensions: len(embedding),
			Status:             "failed",
		}
	}
	return ValidationResult{Message: "embedding provider validation passed", ObservedDimensions: len(embedding), Status: "passed"}
}

func callProvider(
	ctx context.Context,
	client *http.Client,
	setting RuntimeSetting,
	path string,
	payload map[string]any,
) (map[string]any, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(setting.BaseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "Bearer "+setting.APIKey)
	request.Header.Set("content-type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("provider returned HTTP %d", response.StatusCode)
	}
	var result map[string]any
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return nil, errors.New("provider returned invalid JSON")
	}
	return result, nil
}

func failedValidation(err error) ValidationResult {
	code := "provider_unavailable"
	message := "provider request failed"
	if errors.Is(err, context.DeadlineExceeded) {
		code = "provider_timeout"
		message = "provider request timed out"
	} else if strings.HasPrefix(err.Error(), "provider returned HTTP ") || err.Error() == "provider returned invalid JSON" {
		message = err.Error()
	}
	return ValidationResult{ErrorCode: code, Message: message, Status: "failed"}
}
