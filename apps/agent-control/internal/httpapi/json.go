package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

func (s *Server) readJSONBody(response http.ResponseWriter, request *http.Request) (json.RawMessage, bool) {
	limited := http.MaxBytesReader(response, request.Body, s.config.RequestBodyLimitBytes)

	body, err := io.ReadAll(limited)
	closeErr := limited.Close()
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(
				response,
				http.StatusRequestEntityTooLarge,
				"request_body_too_large",
				"Request body exceeds execution-control request limit.",
				false,
			)
		} else {
			writeError(
				response,
				http.StatusBadRequest,
				"request_body_unreadable",
				"Request body could not be fully read.",
				false,
			)
		}
		return nil, false
	}
	if closeErr != nil {
		writeError(
			response,
			http.StatusBadRequest,
			"request_body_unreadable",
			"Request body could not be fully read.",
			false,
		)
		return nil, false
	}
	if len(body) == 0 {
		return json.RawMessage(`{}`), true
	}

	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil || decoded == nil {
		writeError(
			response,
			http.StatusBadRequest,
			"invalid_json",
			"Request body must be a JSON object.",
			false,
		)
		return nil, false
	}

	return json.RawMessage(body), true
}

func writeError(
	response http.ResponseWriter,
	status int,
	code string,
	message string,
	retryable bool,
) {
	code = safeErrorCode(code)
	writeJSON(response, status, map[string]any{
		"error": errorInfo{
			Code:      code,
			Message:   publicErrorMessage(code, message),
			Retryable: retryable,
		},
	})
}

func safeErrorCode(code string) string {
	code = strings.TrimSpace(code)
	if len(code) == 0 || len(code) > 80 {
		return "internal_error"
	}
	for _, char := range code {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '_' || char == '-' || char == '.' || char == ':' {
			continue
		}
		return "internal_error"
	}
	return code
}

func publicErrorMessage(code string, _ string) string {
	switch code {
	case "unauthorized":
		return "Authorization failed."
	case "invalid_request", "invalid_body", "invalid_json":
		return "Request is invalid."
	case "unsupported_media_type":
		return "Request content type is not supported."
	case "request_body_too_large":
		return "Request body exceeds the execution-control request limit."
	case "request_body_unreadable":
		return "Request body could not be read."
	case "execution_workflow_input_invalid":
		return "Execution workflow input is invalid."
	case "dependency_not_ready":
		return "A required execution dependency is not ready."
	case "execution_run_create_failed":
		return "Execution run could not be created."
	case "execution_run_query_failed", "durable_run_query_failed":
		return "Execution run could not be read."
	case "execution_run_steps_query_failed":
		return "Execution run steps could not be read."
	case "execution_step_attempts_query_failed":
		return "Execution step attempts could not be read."
	case "execution_step_results_query_failed":
		return "Execution step results could not be read."
	case "execution_run_cancel_conflict":
		return "Execution run could not be cancelled in its current state."
	case "execution_run_cancel_request_failed":
		return "Execution run cancellation could not be recorded."
	case "execution_run_not_found", "durable_run_not_found":
		return "Execution run was not found."
	case "owner_deletion_not_drained":
		return "Owner deletion is still draining."
	case "owner_deletion_begin_failed", "owner_deletion_finalize_failed":
		return "Owner deletion could not be completed."
	case "owner_deletion_not_started":
		return "Owner deletion was not started."
	case "owner_deleting":
		return "Owner deletion is in progress."
	case "owner_deleted":
		return "Owner has been deleted."
	case "personal_memory_state_unavailable", "personal_memory_state_delete_failed":
		return "Personal memory state is temporarily unavailable."
	case "run_context_conflict":
		return "Execution run context is invalid."
	case "profile_memory_recall_failed":
		return "Personal memory could not be loaded."
	case "model_setting_invalid":
		return "Model setting is invalid."
	case "model_settings_not_ready", "model_settings_unavailable":
		return "Model settings are temporarily unavailable."
	case "model_setting_not_found":
		return "Model setting was not found."
	case "api_key_required":
		return "API key is required."
	case "temporal_not_ready", "temporal_unavailable":
		return "Temporal workflow service is temporarily unavailable."
	case "temporal_admission_failed":
		return "Workflow admission could not be completed."
	case "not_found":
		return "Route was not found."
	default:
		return "Execution-control request could not be completed."
	}
}

func writeJSON(response http.ResponseWriter, status int, body any) {
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(body)
}

func decodeJSONObject(rawBody []byte) (map[string]any, error) {
	var body map[string]any
	if err := json.Unmarshal(rawBody, &body); err != nil || body == nil {
		return nil, errors.New("invalid JSON object")
	}
	return body, nil
}

func defaultString(value string, defaultValue string) string {
	if value == "" {
		return defaultValue
	}
	return value
}
