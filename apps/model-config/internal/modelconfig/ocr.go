package modelconfig

import (
	"context"
	"errors"
	"time"
)

var ErrConfigChanged = errors.New("model config changed since OCR validation started")

func ValidateOCRInput(input ConfigInput, apiKey string) error {
	return validateShape(Target{Name: input.Name, Provider: input.Provider, APIProtocol: input.APIProtocol, BaseURL: input.BaseURL, Model: input.Model}, apiKey)
}

// updated_at also changes on credential rotation, unlike target_sha256.
func (s *Store) RecordOCRValidation(ctx context.Context, expected time.Time, actor string, validation Validation) error {
	if validation.Status != "passed" && validation.Status != "failed" {
		return errors.New("invalid OCR validation status")
	}
	result, err := s.pool.Exec(ctx, `update model_config.model_configs set validation_status=$2,validation_error_code=$3,validation_message=$4,validation_observed_dimensions=null,validated_at=now(),validated_by=$5 where name='document_ocr' and updated_at=$1`,
		expected, validation.Status, validation.ErrorCode, validation.Message, validationActor(actor))
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrConfigChanged
	}
	return nil
}
