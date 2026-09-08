package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/modelconfig"
)

func (s *Server) serveOCRValidationResult(w http.ResponseWriter, r *http.Request) {
	var input struct {
		UpdatedAt  time.Time              `json:"updated_at"`
		Validation modelconfig.Validation `json:"validation"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.UpdatedAt.IsZero() || (input.Validation.Status != "passed" && input.Validation.Status != "failed") {
		writeError(w, http.StatusBadRequest, "invalid_validation", "Expected config updated_at and validation result.")
		return
	}
	recorder, ok := s.store.(interface {
		RecordOCRValidation(context.Context, time.Time, string, modelconfig.Validation) error
	})
	if !ok {
		writeError(w, 503, "model_config_unavailable", "OCR validation unavailable.")
		return
	}
	err := recorder.RecordOCRValidation(r.Context(), input.UpdatedAt, validationActor(r), input.Validation)
	if errors.Is(err, modelconfig.ErrConfigChanged) {
		writeError(w, http.StatusConflict, "model_config_changed", "Configuration changed; result ignored.")
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	noStore(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "recorded"})
}
