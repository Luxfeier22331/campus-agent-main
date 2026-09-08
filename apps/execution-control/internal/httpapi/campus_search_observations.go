package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdiagnostics"
)

func (s *Server) handleCampusSearchObservation(w http.ResponseWriter, r *http.Request, requestID string) {
	if !s.executionQueryAuthorized(r) {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Invalid internal query auth.", false)
		return
	}
	body, ok := s.readJSONBody(w, r)
	if !ok {
		return
	}
	var observation campusdiagnostics.Observation
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&observation); err != nil {
		writeError(w, 400, "invalid_request", "Invalid campus search observation.", false)
		return
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF || observation.ValidateRuntime() != nil {
		writeError(w, 400, "invalid_request", "Invalid campus search observation.", false)
		return
	}
	observation.RequestID = requestID
	campusdiagnostics.Record(r.Context(), s.runProjectionStore, observation)
	w.WriteHeader(http.StatusNoContent)
}
