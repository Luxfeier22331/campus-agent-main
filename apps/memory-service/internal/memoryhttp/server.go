package memoryhttp

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"io"
	"net/http"
)

type Server struct {
	Management   *memoryapplication.MemoryManagementService
	Admission    *memoryapplication.Admission
	Requests     memoryruntime.DurableRequestStore
	Profile      memoryapplication.ProfileReader
	Recaller     memoryapplication.MemoryRecaller
	SharedSecret string
	Ready        func(context.Context) error
}

func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, code string) {
	write(w, status, map[string]any{"error": map[string]any{"code": code, "retryable": status == 503}})
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && r.URL.Path == "/healthz" {
		write(w, 200, map[string]string{"status": "ok"})
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/readyz" {
		if s.Ready == nil || s.Ready(r.Context()) != nil {
			fail(w, 503, "memory_not_ready")
			return
		}
		write(w, 200, map[string]string{"status": "ready"})
		return
	}
	if s.SharedSecret == "" || r.Header.Get("x-memory-origin-auth") != s.SharedSecret {
		fail(w, 401, "unauthorized")
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		fail(w, 405, "method_not_allowed")
		return
	}
	switch r.URL.Path {
	case "/internal/memory/commands":
		s.command(w, r)
	case "/internal/memory/commands/status":
		s.status(w, r)
	case "/internal/memory/appends":
		s.append(w, r)
	case "/internal/memory/profile":
		s.profile(w, r)
	case "/internal/memory/recall":
		s.recall(w, r)
	case "/internal/memory/owners/finalize":
		s.finalize(w, r)
	default:
		http.NotFound(w, r)
	}
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := d.Decode(v); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("expected one JSON value")
	}
	return nil
}
func admissionResult(w http.ResponseWriter, err error) {
	if errors.Is(err, memoryruntime.ErrRequestConflict) || errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		fail(w, 409, "memory_request_conflict")
		return
	}
	if err != nil {
		fail(w, 503, "memory_admission_failed")
		return
	}
	write(w, 202, map[string]any{})
}
func (s *Server) command(w http.ResponseWriter, r *http.Request) {
	var v memoryruntime.PersonalMemoryCommandRequest
	if decode(w, r, &v) != nil || memoryruntime.ValidatePersonalMemoryCommandRequest(v) != nil {
		fail(w, 400, "invalid_request")
		return
	}
	admissionResult(w, s.Management.StartCommand(r.Context(), v))
}
func (s *Server) append(w http.ResponseWriter, r *http.Request) {
	var v memoryruntime.AppendConversationTurnRequest
	if decode(w, r, &v) != nil || memoryruntime.ValidateAppendConversationTurnRequest(v) != nil {
		fail(w, 400, "invalid_request")
		return
	}
	admissionResult(w, s.Admission.Append(r.Context(), v))
}
func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	var v struct {
		CommandID string `json:"command_id"`
		TenantID  string `json:"tenant_id"`
		UserID    string `json:"user_id"`
	}
	if decode(w, r, &v) != nil || v.CommandID == "" || v.TenantID == "" || v.UserID == "" {
		fail(w, 400, "invalid_request")
		return
	}
	req, err := s.Requests.GetRequest(r.Context(), v.CommandID)
	if errors.Is(err, memoryruntime.ErrRequestNotFound) || (err == nil && req.OwnerHash != memoryruntime.OwnerScopeHash(s.Admission.OwnerSalt, v.TenantID, v.UserID)) {
		fail(w, 404, "command_not_found")
		return
	}
	if err != nil {
		fail(w, 503, "memory_status_failed")
		return
	}
	st, err := s.Management.CommandStatus(r.Context(), v.TenantID, v.UserID, v.CommandID)
	if errors.Is(err, memoryruntime.ErrMemoryCommandNotFound) {
		status, code := "pending", ""
		if req.State == "succeeded" || req.State == "failed" {
			var result memoryruntime.PersonalMemoryCommandResult
			if json.Unmarshal(req.Result, &result) == nil {
				status, code = req.State, result.ErrorCode
			}
		}
		write(w, 200, map[string]any{"command_id": v.CommandID, "status": status, "stale": false, "error_code": code})
		return
	}
	if err != nil {
		fail(w, 503, "memory_status_failed")
		return
	}
	write(w, 200, map[string]any{"command_id": v.CommandID, "status": st.Receipt.Status, "error_code": st.Receipt.ErrorCode, "generation": st.Receipt.Generation, "kind": st.Receipt.Kind, "sequence": st.Receipt.Sequence, "stale": st.Stale})
}
func (s *Server) profile(w http.ResponseWriter, r *http.Request) {
	var v memoryruntime.ProfileQuery
	if decode(w, r, &v) != nil || memoryruntime.ValidateProfileQuery(v) != nil {
		fail(w, 400, "invalid_request")
		return
	}
	if s.Profile == nil {
		fail(w, 503, "personal_memory_unavailable")
		return
	}
	out, err := s.Profile.GetProfile(r.Context(), v)
	if errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		fail(w, 409, "memory_lifecycle_blocked")
		return
	}
	if err != nil {
		fail(w, 503, "personal_memory_profile_failed")
		return
	}
	write(w, 200, out)
}
func (s *Server) recall(w http.ResponseWriter, r *http.Request) {
	var v memoryruntime.RecallRequest
	if decode(w, r, &v) != nil || memoryruntime.ValidateRecallRequest(v) != nil {
		fail(w, 400, "invalid_request")
		return
	}
	if s.Recaller == nil {
		fail(w, 503, "personal_memory_unavailable")
		return
	}
	out, err := s.Recaller.Recall(r.Context(), v)
	if errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		fail(w, 409, "memory_lifecycle_blocked")
		return
	}
	if err != nil {
		fail(w, 503, "personal_memory_recall_failed")
		return
	}
	write(w, 200, out)
}
func (s *Server) finalize(w http.ResponseWriter, r *http.Request) {
	var v struct {
		TenantID string `json:"tenant_id"`
		UserID   string `json:"user_id"`
	}
	if decode(w, r, &v) != nil || v.TenantID == "" || v.UserID == "" {
		fail(w, 400, "invalid_request")
		return
	}
	err := s.Management.MarkOwnerDeleted(r.Context(), v.TenantID, v.UserID)
	if errors.Is(err, memoryruntime.ErrMemoryOwnerNotDrained) {
		fail(w, 409, "memory_owner_not_drained")
		return
	}
	if err != nil {
		fail(w, 503, "memory_owner_finalize_failed")
		return
	}
	write(w, 200, map[string]any{})
}
