package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	searchapi "github.com/MUC-WIKI/campus-agent/packages/search-api-go"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/MUC-WIKI/campus-agent/apps/campus-search/internal/service"
)

type Server struct {
	service         *service.Service
	internalToken   string
	mcpClientTokens map[string]string
	mu              sync.Mutex
	slots           map[string]chan struct{}
	logger          *slog.Logger
	searchTimeout   time.Duration
}

const defaultSearchTimeout = 55 * time.Second

func New(serviceInstance *service.Service, internalToken string, mcpClientTokens map[string]string) *Server {
	return NewWithLogger(serviceInstance, internalToken, mcpClientTokens, slog.Default())
}

func NewWithLogger(serviceInstance *service.Service, internalToken string, mcpClientTokens map[string]string, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	return &Server{service: serviceInstance, internalToken: strings.TrimSpace(internalToken), mcpClientTokens: mcpClientTokens, slots: map[string]chan struct{}{}, logger: logger, searchTimeout: defaultSearchTimeout}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/search", s.handlePublic)
	mux.HandleFunc("/internal/v1/search", s.handleInternal)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if s.service == nil || s.service.Readiness(r.Context()) != nil {
			writeError(w, http.StatusServiceUnavailable, "unavailable", "Campus Search is not configured.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	return mux
}

type publicRequest struct {
	Query      string `json:"query"`
	SearchGoal string `json:"search_goal,omitempty"`
}
type internalRequest struct {
	Query             string   `json:"query"`
	SearchGoal        string   `json:"search_goal,omitempty"`
	ExcludeResultRefs []string `json:"exclude_result_refs,omitempty"`
	ResultLimit       int      `json:"result_limit,omitempty"`
}

func (s *Server) handlePublic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST is required.")
		return
	}
	caller, ok := s.authorizeMCPClient(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Invalid MCP client token.")
		return
	}
	release, ok := s.acquireCaller(caller)
	if !ok {
		writeError(w, http.StatusTooManyRequests, "caller_concurrency_exceeded", "Campus Search caller concurrency limit exceeded.")
		return
	}
	defer release()
	var request publicRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	searchCtx, cancel := s.searchContext(r.Context())
	defer cancel()
	response, err := s.service.Search(searchCtx, service.SearchRequest{Query: request.Query, SearchGoal: request.SearchGoal, QueryLimit: searchapi.SearchQueryLimit, SearchGoalLimit: searchapi.SearchGoalLimit})
	if err != nil {
		s.writeSearchError(w, err, response.Diagnostics, false)
		return
	}
	writeJSON(w, http.StatusOK, service.PublicResult(response.Results))
}

func (s *Server) handleInternal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST is required.")
		return
	}
	if strings.TrimSpace(s.internalToken) == "" || bearerToken(r) != s.internalToken {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Invalid retrieval internal token.")
		return
	}
	var request internalRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	searchCtx, cancel := s.searchContext(r.Context())
	defer cancel()
	response, err := s.service.Search(searchCtx, service.SearchRequest{Query: request.Query, SearchGoal: request.SearchGoal, ExcludedResultRefs: request.ExcludeResultRefs, ResultLimit: request.ResultLimit, CitationStart: 1, QueryLimit: searchapi.InternalSearchQueryLimit, SearchGoalLimit: searchapi.InternalSearchGoalLimit})
	if err != nil {
		s.writeSearchError(w, err, response.Diagnostics, true)
		return
	}
	writeJSON(w, http.StatusOK, service.InternalResult(response))
}

func (s *Server) searchContext(parent context.Context) (context.Context, context.CancelFunc) {
	if s.searchTimeout <= 0 {
		return parent, func() {}
	}
	return context.WithTimeout(parent, s.searchTimeout)
}

func (s *Server) acquireCaller(caller string) (func(), bool) {
	s.mu.Lock()
	slots := s.slots[caller]
	if slots == nil {
		slots = make(chan struct{}, 8)
		s.slots[caller] = slots
	}
	s.mu.Unlock()
	select {
	case slots <- struct{}{}:
		return func() { <-slots }, true
	default:
		return nil, false
	}
}

func (s *Server) authorizeMCPClient(r *http.Request) (string, bool) {
	token := bearerToken(r)
	if token == "" {
		return "", false
	}
	for caller, configured := range s.mcpClientTokens {
		if token == configured {
			return caller, true
		}
	}
	return "", false
}

func (s *Server) writeSearchError(w http.ResponseWriter, err error, diagnostics *campussearch.Snapshot, internal bool) {
	status := http.StatusServiceUnavailable
	detail := campussearch.SearchErrorDetail{Code: "campus_search_failed", Message: "Campus Search failed."}
	switch {
	case errors.Is(err, service.ErrUnavailable):
		detail = campussearch.SearchErrorDetail{Code: "campus_search_unavailable", Message: "Campus Search index is not available."}
	case errors.Is(err, context.DeadlineExceeded) || strings.Contains(strings.ToLower(err.Error()), "timeout"):
		status = http.StatusGatewayTimeout
		detail = campussearch.SearchErrorDetail{Code: "campus_search_timeout", Message: "Campus Search timed out."}
	case diagnostics != nil && diagnostics.FailedStage == "validation":
		status = http.StatusBadRequest
		detail = campussearch.SearchErrorDetail{Code: "invalid_request", Message: err.Error()}
	}
	response := campussearch.SearchErrorResponse{Error: detail}
	if internal {
		response.Diagnostics = diagnostics
	}
	writeJSON(w, status, response)
}

func decodeJSON(r *http.Request, target any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("request has trailing JSON content")
	}
	return nil
}

func bearerToken(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("authorization"))
	if !strings.HasPrefix(value, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
