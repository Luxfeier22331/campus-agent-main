package providerconfig

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) ValidateProfile(
	ctx context.Context,
	actor string,
	idempotencyKey string,
	requestHash string,
	profileID string,
) (ValidationResult, int, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return ValidationResult{}, 400, errors.New("Idempotency-Key is required")
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return ValidationResult{}, 500, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, "execution_config.command_receipt:"+idempotencyKey); err != nil {
		return ValidationResult{}, 500, err
	}
	existingRaw, existingStatus, found, err := readCommandReceiptTx(ctx, tx, idempotencyKey, "validate_profile", requestHash)
	if err != nil {
		return ValidationResult{}, existingStatus, err
	}
	if found {
		var existing ValidationResult
		if err := json.Unmarshal(existingRaw, &existing); err != nil {
			return ValidationResult{}, 500, err
		}
		return existing, existingStatus, nil
	}
	snapshot, err := s.resolveProfile(ctx, profileID, 1)
	if err != nil {
		return ValidationResult{}, 422, err
	}
	result := validateSnapshot(ctx, snapshot)
	now := time.Now().UTC()
	if _, err := tx.Exec(ctx, `insert into execution_config.profile_validations(validation_id,profile_id,status,error_code,message,observed_dimensions,validated_at,validated_by) values($1,$2,$3,$4,$5,nullif($6,0),$7,$8)`, newID("validation"), profileID, result.Status, result.ErrorCode, result.Message, result.ObservedDimensions, now, actor); err != nil {
		return ValidationResult{}, 500, err
	}
	if err := writeCommandReceiptTx(ctx, tx, idempotencyKey, "validate_profile", requestHash, 200, result, now); err != nil {
		return ValidationResult{}, 500, err
	}
	if err := writeAuditTx(ctx, tx, actor, "provider_profile.validated", profileID, map[string]any{"status": result.Status, "errorCode": result.ErrorCode}); err != nil {
		return ValidationResult{}, 500, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ValidationResult{}, 500, err
	}
	return result, 200, nil
}

func validateSnapshot(ctx context.Context, snapshot RuntimeSnapshot) ValidationResult {
	if err := validateSnapshotShape(snapshot); err != nil {
		return ValidationResult{ErrorCode: "invalid_profile", Message: err.Error(), Status: "failed"}
	}
	timeout := time.Duration(snapshot.TimeoutMS) * time.Millisecond
	validationCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	client := &http.Client{Timeout: timeout}
	switch Role(snapshot.Role) {
	case RolePrimaryAgent:
		return validatePrompt(validationCtx, client, snapshot)
	case RoleRAGQueryEmbedding:
		return validateEmbedding(validationCtx, client, snapshot)
	case RoleRAGReranker:
		return validateRerank(validationCtx, client, snapshot)
	default:
		return ValidationResult{ErrorCode: "unsupported_role", Message: "provider role is unsupported", Status: "failed"}
	}
}

func validateSnapshotShape(snapshot RuntimeSnapshot) error {
	if strings.TrimSpace(snapshot.APIKey) == "" || strings.TrimSpace(snapshot.BaseURL) == "" || strings.TrimSpace(snapshot.Model) == "" {
		return errors.New("api key, base url, and model are required")
	}
	if !strings.HasPrefix(snapshot.BaseURL, "https://") && !strings.HasPrefix(snapshot.BaseURL, "http://127.0.0.1") && !strings.HasPrefix(snapshot.BaseURL, "http://localhost") {
		return errors.New("provider base url must use https outside loopback")
	}
	if Role(snapshot.Role) == RoleRAGQueryEmbedding && snapshot.Dimensions <= 0 {
		return errors.New("embedding dimensions must be positive")
	}
	return nil
}

func validatePrompt(ctx context.Context, client *http.Client, snapshot RuntimeSnapshot) ValidationResult {
	result, _, err := callProvider(ctx, client, snapshot, "/responses", map[string]any{
		"input": "Return OK.", "max_output_tokens": 8, "model": snapshot.Model,
	})
	if err != nil {
		return failedValidation(err)
	}
	if result["id"] == nil && result["output"] == nil {
		return ValidationResult{ErrorCode: "invalid_response", Message: "prompt provider response is missing output", Status: "failed"}
	}
	return ValidationResult{Message: "prompt provider validation passed", Status: "passed"}
}

func validateEmbedding(ctx context.Context, client *http.Client, snapshot RuntimeSnapshot) ValidationResult {
	result, _, err := callProvider(ctx, client, snapshot, "/embeddings", map[string]any{
		"dimensions": snapshot.Dimensions, "input": "campus-agent provider validation", "model": snapshot.Model,
	})
	if err != nil {
		return failedValidation(err)
	}
	data, ok := result["data"].([]any)
	if !ok || len(data) == 0 {
		return ValidationResult{ErrorCode: "invalid_response", Message: "embedding provider response is missing data", Status: "failed"}
	}
	item, _ := data[0].(map[string]any)
	embedding, _ := item["embedding"].([]any)
	if len(embedding) != snapshot.Dimensions {
		return ValidationResult{ErrorCode: "dimension_mismatch", Message: fmt.Sprintf("embedding dimensions = %d, want %d", len(embedding), snapshot.Dimensions), ObservedDimensions: len(embedding), Status: "failed"}
	}
	return ValidationResult{Message: "embedding provider validation passed", ObservedDimensions: len(embedding), Status: "passed"}
}

func validateRerank(ctx context.Context, client *http.Client, snapshot RuntimeSnapshot) ValidationResult {
	path := "/rerank"
	if rerank, ok := snapshot.ToolConfig["rerank"].(map[string]any); ok {
		if configured, ok := rerank["path"].(string); ok && strings.HasPrefix(configured, "/") {
			path = configured
		}
	}
	result, _, err := callProvider(ctx, client, snapshot, path, map[string]any{
		"documents": []string{"first", "second"}, "model": snapshot.Model, "query": "first",
	})
	if err != nil {
		return failedValidation(err)
	}
	if result["results"] == nil && result["data"] == nil {
		return ValidationResult{ErrorCode: "invalid_response", Message: "rerank provider response is missing results", Status: "failed"}
	}
	return ValidationResult{Message: "rerank provider validation passed", Status: "passed"}
}

func callProvider(ctx context.Context, client *http.Client, snapshot RuntimeSnapshot, path string, payload map[string]any) (map[string]any, int, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(snapshot.BaseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("authorization", "Bearer "+snapshot.APIKey)
	request.Header.Set("content-type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, response.StatusCode, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, response.StatusCode, fmt.Errorf("provider returned HTTP %d", response.StatusCode)
	}
	var result map[string]any
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return nil, response.StatusCode, errors.New("provider returned invalid JSON")
	}
	return result, response.StatusCode, nil
}

func failedValidation(err error) ValidationResult {
	code := "provider_unavailable"
	if errors.Is(err, context.DeadlineExceeded) {
		code = "provider_timeout"
	}
	return ValidationResult{ErrorCode: code, Message: err.Error(), Status: "failed"}
}
