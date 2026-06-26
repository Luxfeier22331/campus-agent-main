package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
)

func (s *Server) handleTransportStatusProjection(
	response http.ResponseWriter,
	request *http.Request,
) {
	if !s.structuredQueryAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid structured query auth.", false)
		return
	}
	ctx, cancel := contextWithStructuredQueryTimeout(request, s.config.StructuredQueryTimeoutMS)
	defer cancel()
	result := s.structuredQuery.TransportStatusProjection(ctx)
	setOutcome(response, result.Outcome)
	if projection, ok := result.Body.(structuredquery.TransportStatusProjection); ok {
		response.Header().Set("etag", transportStatusProjectionETag(projection))
	}
	writeJSON(response, result.StatusCode, result.Body)
}

func contextWithStructuredQueryTimeout(
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
	projection structuredquery.TransportStatusProjection,
) string {
	payload, err := json.Marshal(projection)
	if err != nil {
		return `"campus-services-transport-status:invalid"`
	}
	sum := sha256.Sum256(payload)
	return `"campus-services-transport-status:` + projection.Release.ReleaseID + `:` +
		hex.EncodeToString(sum[:8]) + `"`
}
