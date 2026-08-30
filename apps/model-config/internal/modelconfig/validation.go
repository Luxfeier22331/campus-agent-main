package modelconfig

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

const embeddingModel = "Qwen3-Embedding-4B"
const embeddingDimensions = 2560
const rerankAPIProtocol = "cohere.rerank"

var noticeClassificationCategories = []string{
	"research_affairs",
	"lectures_forums",
	"teaching_affairs",
	"student_affairs",
	"competitions",
	"admissions",
	"international_programs",
	"employment",
	"campus_operations",
	"human_resources",
	"governance",
	"procurement",
	"campus_activities",
	"campus_news",
	"unclassified",
}

var noticeClassificationCategorySet = func() map[string]struct{} {
	result := make(map[string]struct{}, len(noticeClassificationCategories))
	for _, category := range noticeClassificationCategories {
		result[category] = struct{}{}
	}
	return result
}()

func Validate(ctx context.Context, target Target, apiKey string) Validation {
	if err := validateShape(target, apiKey); err != nil {
		return Validation{Status: "failed", ErrorCode: "invalid_setting", Message: err.Error()}
	}
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	endpoint, body, err := validationRequest(target)
	if err != nil {
		return Validation{Status: "failed", ErrorCode: "invalid_protocol", Message: err.Error()}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return Validation{Status: "failed", ErrorCode: "request_build_failed", Message: err.Error()}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return Validation{Status: "failed", ErrorCode: "request_build_failed", Message: err.Error()}
	}
	req.Header.Set("authorization", "Bearer "+apiKey)
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return Validation{Status: "failed", ErrorCode: "provider_unavailable", Message: fmt.Sprintf("model provider request failed: %v", err)}
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return Validation{Status: "failed", ErrorCode: "invalid_provider_response", Message: fmt.Sprintf("read model provider HTTP %s response: %v", resp.Status, err)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Validation{
			Status:    "failed",
			ErrorCode: fmt.Sprintf("provider_http_%d", resp.StatusCode),
			Message:   fmt.Sprintf("model provider returned HTTP %s; response body: %s", resp.Status, responseBody(raw)),
		}
	}
	if target.APIProtocol == "openai.embeddings" {
		var decoded struct {
			Data []struct {
				Embedding []float64 `json:"embedding"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return invalidProviderResponse(resp, raw, fmt.Sprintf("decode embedding response: %v", err))
		}
		if len(decoded.Data) == 0 {
			return invalidProviderResponse(resp, raw, "embedding response has no data")
		}
		if len(decoded.Data[0].Embedding) != embeddingDimensions {
			return Validation{Status: "failed", ErrorCode: "embedding_dimensions_mismatch", Message: fmt.Sprintf("model provider returned HTTP %s with embedding dimensions = %d, want %d; response body: %s", resp.Status, len(decoded.Data[0].Embedding), embeddingDimensions, responseBody(raw)), ObservedDimensions: len(decoded.Data[0].Embedding)}
		}
		return Validation{Status: "passed", Message: "model provider validation passed", ObservedDimensions: embeddingDimensions}
	}
	if target.APIProtocol == rerankAPIProtocol {
		var decoded struct {
			Results []struct {
				Index          *int     `json:"index"`
				RelevanceScore *float64 `json:"relevance_score"`
			} `json:"results"`
		}
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return invalidProviderResponse(resp, raw, fmt.Sprintf("decode rerank response: %v", err))
		}
		if len(decoded.Results) != 1 ||
			decoded.Results[0].Index == nil ||
			*decoded.Results[0].Index != 0 ||
			decoded.Results[0].RelevanceScore == nil ||
			math.IsNaN(*decoded.Results[0].RelevanceScore) ||
			math.IsInf(*decoded.Results[0].RelevanceScore, 0) {
			return invalidProviderResponse(resp, raw, "rerank response must contain one finite result for document 0")
		}
	}
	if target.APIProtocol == "openai.responses" || target.APIProtocol == "openai.chat_completions" {
		validator := validateTextProviderResponse
		if target.Name == ConfigNoticeClassification {
			validator = validateNoticeClassificationResponse
		}
		if err := validator(target.APIProtocol, raw); err != nil {
			return invalidProviderResponse(resp, raw, err.Error())
		}
	}
	return Validation{Status: "passed", Message: "model provider validation passed"}
}

func validationRequest(target Target) (string, any, error) {
	switch target.APIProtocol {
	case "openai.responses":
		if target.Name == ConfigNoticeClassification {
			return target.BaseURL + "/responses", map[string]any{
				"input": []map[string]string{
					{"role": "system", "content": "Classify the notice title and return only the JSON object required by the schema."},
					{"role": "user", "content": `{"notice_title":"model-config validation"}`},
				},
				"max_output_tokens": 64,
				"model":             target.Model,
				"temperature":       0,
				"text": map[string]any{
					"format": noticeClassificationJSONSchema("responses"),
				},
			}, nil
		}
		return target.BaseURL + "/responses", map[string]any{
			"model":             target.Model,
			"input":             "model-config validation",
			"max_output_tokens": 1,
		}, nil
	case "openai.chat_completions":
		if target.Name == ConfigNoticeClassification {
			return target.BaseURL + "/chat/completions", map[string]any{
				"messages": []map[string]string{
					{"role": "system", "content": "Classify the notice title and return only the JSON object required by the schema."},
					{"role": "user", "content": `{"notice_title":"model-config validation"}`},
				},
				"max_tokens":  64,
				"model":       target.Model,
				"temperature": 0,
				"response_format": map[string]any{
					"type":        "json_schema",
					"json_schema": noticeClassificationJSONSchema("chat_completions"),
				},
			}, nil
		}
		return target.BaseURL + "/chat/completions", map[string]any{
			"model": target.Model,
			"messages": []map[string]string{
				{"role": "user", "content": "model-config validation"},
			},
			"max_tokens": 1,
		}, nil
	case "openai.embeddings":
		return target.BaseURL + "/embeddings", map[string]any{
			"model":      target.Model,
			"input":      []string{"model-config validation"},
			"dimensions": embeddingDimensions,
		}, nil
	case rerankAPIProtocol:
		return target.BaseURL + "/rerank", map[string]any{
			"documents": []string{"model-config validation document"},
			"model":     target.Model,
			"query":     "model-config validation",
		}, nil
	default:
		return "", nil, errors.New("unsupported api_protocol")
	}
}

func noticeClassificationJSONSchema(protocol string) map[string]any {
	schema := map[string]any{
		"additionalProperties": false,
		"properties": map[string]any{
			"category": map[string]any{"enum": noticeClassificationCategories, "type": "string"},
		},
		"required": []string{"category"},
		"type":     "object",
	}
	result := map[string]any{
		"name":   "notice_classification",
		"schema": schema,
		"strict": true,
	}
	if protocol == "responses" {
		result["type"] = "json_schema"
	}
	return result
}

func validateTextProviderResponse(protocol string, raw []byte) error {
	switch protocol {
	case "openai.responses":
		var response struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &response); err != nil || strings.TrimSpace(response.ID) == "" {
			return errors.New("responses response id is missing")
		}
	case "openai.chat_completions":
		var response struct {
			Choices []struct {
				Message json.RawMessage `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(raw, &response); err != nil || len(response.Choices) == 0 {
			return errors.New("chat completion message is missing")
		}
		message := bytes.TrimSpace(response.Choices[0].Message)
		if len(message) == 0 || message[0] != '{' {
			return errors.New("chat completion message is missing")
		}
	default:
		return errors.New("unsupported text provider protocol")
	}
	return nil
}

func validateNoticeClassificationResponse(protocol string, raw []byte) error {
	text, err := textProviderOutput(protocol, raw)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.DisallowUnknownFields()
	var output struct {
		Category string `json:"category"`
	}
	if err := decoder.Decode(&output); err != nil {
		return fmt.Errorf("decode notice classification output: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("notice classification output must contain one JSON object")
	}
	if _, ok := noticeClassificationCategorySet[output.Category]; !ok {
		return fmt.Errorf("notice classification category %q is not allowed", output.Category)
	}
	return nil
}

func textProviderOutput(protocol string, raw []byte) (string, error) {
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return "", fmt.Errorf("decode %s response: %w", protocol, err)
	}
	response, ok := decoded.(map[string]any)
	if !ok {
		return "", fmt.Errorf("%s response must be an object", protocol)
	}
	if protocol == "openai.responses" {
		if text, ok := response["output_text"].(string); ok && text != "" {
			return text, nil
		}
		output, _ := response["output"].([]any)
		for _, rawItem := range output {
			item, _ := rawItem.(map[string]any)
			content, _ := item["content"].([]any)
			for _, rawContent := range content {
				part, _ := rawContent.(map[string]any)
				if text, ok := part["text"].(string); ok && text != "" {
					return text, nil
				}
			}
		}
		return "", errors.New("responses output text is missing")
	}
	if protocol == "openai.chat_completions" {
		choices, _ := response["choices"].([]any)
		if len(choices) == 0 {
			return "", errors.New("chat completion choice is missing")
		}
		choice, _ := choices[0].(map[string]any)
		message, _ := choice["message"].(map[string]any)
		switch content := message["content"].(type) {
		case string:
			if content != "" {
				return content, nil
			}
		case []any:
			var builder strings.Builder
			for _, rawPart := range content {
				part, _ := rawPart.(map[string]any)
				if text, ok := part["text"].(string); ok {
					builder.WriteString(text)
				}
			}
			if builder.Len() > 0 {
				return builder.String(), nil
			}
		}
		return "", errors.New("chat completion content is missing")
	}
	return "", errors.New("unsupported text provider protocol")
}

func invalidProviderResponse(resp *http.Response, raw []byte, reason string) Validation {
	return Validation{
		Status:    "failed",
		ErrorCode: "invalid_provider_response",
		Message:   fmt.Sprintf("model provider returned HTTP %s with an invalid response: %s; response body: %s", resp.Status, reason, responseBody(raw)),
	}
}

func responseBody(raw []byte) string {
	if len(bytes.TrimSpace(raw)) == 0 {
		return "<empty>"
	}
	return string(raw)
}

func DiscoverModels(ctx context.Context, name ConfigName, provider, baseURL, apiKey string) ([]string, Validation) {
	provider = strings.TrimSpace(provider)
	normalized, err := NormalizeBaseURL(baseURL)
	if err != nil || !discoveryProviderAllowed(name, provider) || strings.TrimSpace(apiKey) == "" {
		message := "provider, base_url and api_key are required"
		if err != nil {
			message = err.Error()
		}
		return nil, Validation{Status: "failed", ErrorCode: "invalid_setting", Message: message}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, normalized+"/models", nil)
	if err != nil {
		return nil, Validation{Status: "failed", ErrorCode: "request_build_failed", Message: "model discovery request is invalid"}
	}
	req.Header.Set("authorization", "Bearer "+apiKey)
	req.Header.Set("accept", "application/json")
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return nil, Validation{Status: "failed", ErrorCode: "provider_unavailable", Message: "model provider request failed"}
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, Validation{Status: "failed", ErrorCode: fmt.Sprintf("provider_http_%d", resp.StatusCode), Message: "model provider rejected discovery"}
	}
	var decoded struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	decoder := json.NewDecoder(resp.Body)
	if err := decoder.Decode(&decoded); err != nil {
		return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "provider model response is invalid"}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "provider model response is invalid"}
	}
	var items []string
	switch provider {
	case "cohere", "cohere-compatible":
		if decoded.Models == nil {
			return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "provider model response is invalid"}
		}
		items = make([]string, 0, len(decoded.Models))
		for _, item := range decoded.Models {
			items = append(items, item.Name)
		}
	default:
		if decoded.Data == nil {
			return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "provider model response is invalid"}
		}
		items = make([]string, 0, len(decoded.Data))
		for _, item := range decoded.Data {
			items = append(items, item.ID)
		}
	}
	unique := make(map[string]struct{}, len(items))
	for _, rawID := range items {
		id := strings.TrimSpace(rawID)
		if id == "" || len(id) > 256 {
			return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "provider model response contains an invalid id"}
		}
		unique[id] = struct{}{}
	}
	models := make([]string, 0, len(unique))
	for id := range unique {
		models = append(models, id)
	}
	sort.Strings(models)
	return models, Validation{Status: "passed", Message: "provider model discovery passed"}
}

func discoveryProviderAllowed(name ConfigName, provider string) bool {
	switch name {
	case ConfigPrimaryAgent, ConfigNoticeClassification:
		return provider == "openai" || provider == "openai-compatible"
	case ConfigCampusDocsReranker:
		return provider == "cohere" || provider == "cohere-compatible"
	default:
		return false
	}
}

func validateShape(target Target, apiKey string) error {
	if target.Name == "" || target.Provider == "" || target.APIProtocol == "" || target.BaseURL == "" || target.Model == "" || strings.TrimSpace(apiKey) == "" {
		return errors.New("name, provider, api_protocol, base_url, model and api_key are required")
	}
	if target.Name != ConfigPrimaryAgent && target.Name != ConfigCampusDocsEmbedding && target.Name != ConfigCampusDocsReranker && target.Name != ConfigNoticeClassification {
		return errors.New("name is invalid")
	}
	if target.Name == ConfigCampusDocsEmbedding && (target.Provider != "openai-compatible" || target.APIProtocol != "openai.embeddings" || target.Model != embeddingModel) {
		return errors.New("embedding target is fixed by the Campus Docs contract")
	}
	if target.Name == ConfigCampusDocsReranker {
		if (target.Provider != "cohere" && target.Provider != "cohere-compatible") || target.APIProtocol != rerankAPIProtocol {
			return errors.New("reranker target is fixed by the Campus Docs contract")
		}
		return nil
	}
	if target.Provider != "openai" && target.Provider != "openai-compatible" {
		return errors.New("provider is invalid")
	}
	if target.Name != ConfigCampusDocsEmbedding && target.APIProtocol != "openai.responses" && target.APIProtocol != "openai.chat_completions" {
		return errors.New("text target api_protocol is invalid")
	}
	return nil
}
