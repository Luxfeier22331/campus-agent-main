package providerconfig

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	maxDiscoveredModels = 500
	maxProviderBodySize = 1 << 20
	ValidationTimeout   = 10 * time.Second
)

func Validate(ctx context.Context, setting RuntimeSetting) ValidationResult {
	if err := validateSettingShape(setting); err != nil {
		return ValidationResult{ErrorCode: "invalid_setting", Message: err.Error(), Status: "failed"}
	}
	validationCtx, cancel := context.WithTimeout(ctx, ValidationTimeout)
	defer cancel()
	client := &http.Client{Timeout: ValidationTimeout}
	switch setting.Kind {
	case KindLLM, KindNoticeClassifier:
		return validateLLM(validationCtx, client, setting)
	case KindEmbedding:
		return validateEmbedding(validationCtx, client, setting)
	default:
		return ValidationResult{ErrorCode: "unsupported_kind", Message: "model setting kind is unsupported", Status: "failed"}
	}
}

func validateSettingShape(setting RuntimeSetting) error {
	if err := validateProviderConnection(setting); err != nil {
		return err
	}
	if strings.TrimSpace(setting.Model) == "" {
		return errors.New("model is required")
	}
	if setting.Kind == KindEmbedding && setting.Transport != CanonicalEmbeddingTransport {
		return fmt.Errorf("embedding transport must be %s", CanonicalEmbeddingTransport)
	}
	if setting.Kind == KindEmbedding {
		if setting.Provider != CanonicalEmbeddingProvider {
			return fmt.Errorf("embedding provider must be %s", CanonicalEmbeddingProvider)
		}
		if setting.Model != CanonicalEmbeddingModel {
			return fmt.Errorf("embedding model must be %s", CanonicalEmbeddingModel)
		}
	}
	if isTextModelKind(setting.Kind) && setting.Transport != "responses" && setting.Transport != "chat_completions" {
		return errors.New("text model transport must be responses or chat_completions")
	}
	return nil
}

func isTextModelKind(kind Kind) bool {
	return kind == KindLLM || kind == KindNoticeClassifier
}

func validateProviderConnection(setting RuntimeSetting) error {
	if strings.TrimSpace(setting.APIKey) == "" || strings.TrimSpace(setting.BaseURL) == "" {
		return errors.New("api key and base url are required")
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
	return nil
}

func DiscoverModels(ctx context.Context, setting RuntimeSetting) ([]string, ValidationResult) {
	if err := validateProviderConnection(setting); err != nil {
		return nil, ValidationResult{ErrorCode: "invalid_setting", Message: err.Error(), Status: "failed"}
	}
	discoveryCtx, cancel := context.WithTimeout(ctx, ValidationTimeout)
	defer cancel()
	body, err := requestProvider(
		discoveryCtx,
		&http.Client{Timeout: ValidationTimeout},
		setting,
		http.MethodGet,
		"/models",
		nil,
	)
	if err != nil {
		return nil, failedValidation(err)
	}
	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil || result.Data == nil {
		return nil, ValidationResult{
			ErrorCode: "invalid_response",
			Message:   "provider model response is invalid",
			Status:    "failed",
		}
	}
	models := make(map[string]struct{}, len(result.Data))
	for _, item := range result.Data {
		model := strings.TrimSpace(item.ID)
		if model == "" || len(model) > 256 {
			return nil, ValidationResult{
				ErrorCode: "invalid_response",
				Message:   "provider model response contains an invalid id",
				Status:    "failed",
			}
		}
		models[model] = struct{}{}
	}
	values := make([]string, 0, len(models))
	for model := range models {
		values = append(values, model)
	}
	sort.Strings(values)
	if len(values) > maxDiscoveredModels {
		values = values[:maxDiscoveredModels]
	}
	return values, ValidationResult{Message: "provider model discovery passed", Status: "passed"}
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
	} else if result["id"] == nil && result["output"] == nil && !hasNonEmptyString(result["output_text"]) {
		return ValidationResult{ErrorCode: "invalid_response", Message: "provider response is missing output", Status: "failed"}
	}
	return ValidationResult{Message: "llm provider validation passed", Status: "passed"}
}

func hasNonEmptyString(value any) bool {
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) != ""
}

func validateEmbedding(ctx context.Context, client *http.Client, setting RuntimeSetting) ValidationResult {
	result, err := callProvider(ctx, client, setting, "/embeddings", map[string]any{
		"dimensions": CanonicalEmbeddingDimensions,
		"input":      []string{"campus-agent provider validation"},
		"model":      CanonicalEmbeddingModel,
	})
	if err != nil {
		return failedValidation(err)
	}
	data, ok := result["data"].([]any)
	if !ok || len(data) != 1 {
		return ValidationResult{ErrorCode: "invalid_response", Message: "embedding response is missing data", Status: "failed"}
	}
	item, _ := data[0].(map[string]any)
	embedding, _ := item["embedding"].([]any)
	if len(embedding) != CanonicalEmbeddingDimensions {
		return ValidationResult{
			ErrorCode:          "invalid_response",
			Message:            fmt.Sprintf("embedding response dimensions = %d, want %d", len(embedding), CanonicalEmbeddingDimensions),
			ObservedDimensions: len(embedding),
			Status:             "failed",
		}
	}
	for _, value := range embedding {
		number, ok := value.(float64)
		if !ok || math.IsNaN(number) || math.IsInf(number, 0) {
			return ValidationResult{ErrorCode: "invalid_response", Message: "embedding response vector contains a non-finite value", Status: "failed"}
		}
	}
	return ValidationResult{Message: "embedding provider validation passed", ObservedDimensions: CanonicalEmbeddingDimensions, Status: "passed"}
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
	responseBody, err := requestProvider(ctx, client, setting, http.MethodPost, path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return nil, errors.New("provider returned invalid JSON")
	}
	return result, nil
}

func requestProvider(
	ctx context.Context,
	client *http.Client,
	setting RuntimeSetting,
	method string,
	path string,
	body io.Reader,
) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(setting.BaseURL, "/")+path, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "Bearer "+setting.APIKey)
	request.Header.Set("accept", "application/json")
	if body != nil {
		request.Header.Set("content-type", "application/json")
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxProviderBodySize+1))
	if err != nil {
		return nil, err
	}
	if len(responseBody) > maxProviderBodySize {
		return nil, errors.New("provider returned an oversized response")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("provider returned HTTP %d", response.StatusCode)
	}
	return responseBody, nil
}

func failedValidation(err error) ValidationResult {
	code := "provider_unavailable"
	message := "provider request failed"
	if errors.Is(err, context.DeadlineExceeded) {
		code = "provider_timeout"
		message = "provider request timed out"
	} else if strings.HasPrefix(err.Error(), "provider returned HTTP ") ||
		err.Error() == "provider returned invalid JSON" ||
		err.Error() == "provider returned an oversized response" {
		message = err.Error()
	}
	return ValidationResult{ErrorCode: code, Message: message, Status: "failed"}
}
