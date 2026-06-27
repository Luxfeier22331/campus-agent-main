package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

func (s *Server) handleTransportStatusProjection(
	response http.ResponseWriter,
	request *http.Request,
) {
	if !s.toolReadModelAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid tool read model auth.", false)
		return
	}
	ctx, cancel := contextWithToolReadModelTimeout(request, s.config.ToolReadModelTimeoutMS)
	defer cancel()
	result := s.toolReadModel.TransportStatusProjection(ctx)
	setOutcome(response, result.Outcome)
	if projection, ok := result.Body.(toolreadmodel.TransportStatusProjection); ok {
		response.Header().Set("etag", transportStatusProjectionETag(projection))
	}
	writeJSON(response, result.StatusCode, result.Body)
}

func contextWithToolReadModelTimeout(
	request *http.Request,
	timeoutMS int,
) (context.Context, context.CancelFunc) {
	timeout := time.Duration(timeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = time.Second
	}
	return context.WithTimeout(request.Context(), timeout)
}

func transportStatusProjectionETag(
	projection toolreadmodel.TransportStatusProjection,
) string {
	payload, err := json.Marshal(projection)
	if err != nil {
		return `"campus-services-transport-status:invalid"`
	}
	sum := sha256.Sum256(payload)
	return `"campus-services-transport-status:` + projection.Release.ReleaseID + `:` +
		hex.EncodeToString(sum[:8]) + `"`
}
