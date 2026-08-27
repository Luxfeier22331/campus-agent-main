package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const campusSearchToolName = "campus_search"

type campusSearchToolEnvelope struct {
	AccessContext agentToolAccessContext  `json:"access_context"`
	Payload       campusSearchToolPayload `json:"payload"`
}

type campusSearchToolPayload struct {
	Query string `json:"query"`
}

func (s *Server) handleCampusSearchTool(response http.ResponseWriter, request *http.Request) {
	if !s.executionQueryAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid internal query auth.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	envelope, err := decodeCampusSearchToolEnvelope(body)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	result, err := s.executeCampusSearchTool(request.Context(), envelope)
	if err != nil {
		var conflict agentToolConflictError
		if errors.As(err, &conflict) {
			writeError(response, http.StatusConflict, "run_context_conflict", err.Error(), false)
			return
		}
		writeError(response, http.StatusServiceUnavailable, "campus_search_failed", "Campus document search failed.", true)
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func decodeCampusSearchToolEnvelope(body json.RawMessage) (campusSearchToolEnvelope, error) {
	var envelope campusSearchToolEnvelope
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		return envelope, fmt.Errorf("campus_search request is invalid: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return envelope, errors.New("campus_search request has trailing JSON content")
	}
	envelope.Payload.Query = strings.TrimSpace(envelope.Payload.Query)
	envelope.AccessContext.RequestID = strings.TrimSpace(envelope.AccessContext.RequestID)
	envelope.AccessContext.InvocationID = strings.TrimSpace(envelope.AccessContext.InvocationID)
	if envelope.Payload.Query == "" || len([]rune(envelope.Payload.Query)) > 400 {
		return envelope, errors.New("payload.query must contain between 1 and 400 characters")
	}
	if envelope.AccessContext.RequestID == "" ||
		envelope.AccessContext.InvocationID == "" || envelope.AccessContext.ActivityAttempt <= 0 {
		return envelope, errors.New("access_context.request_id, invocation_id, and activity_attempt are required")
	}
	return envelope, nil
}

func (s *Server) executeCampusSearchTool(
	ctx context.Context,
	envelope campusSearchToolEnvelope,
) (map[string]any, error) {
	if _, err := s.validateAgentToolRun(ctx, envelope.AccessContext, campusSearchToolName); err != nil {
		return nil, err
	}
	if s.campusDocsIndexStore == nil {
		return nil, errors.New("campus docs index store is not configured")
	}
	if s.campusDocsQdrantErr != nil {
		return nil, s.campusDocsQdrantErr
	}
	index, found, err := s.campusDocsIndexStore.CurrentIndex(ctx)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, errors.New("campus docs current index is not available")
	}
	evidence, err := retrieveCampusDocsEvidence(ctx, s.campusDocsQdrant, index, envelope.Payload.Query)
	if err != nil {
		return nil, err
	}
	return campusSearchResult(evidence), nil
}
