package httpapi

import (
	"context"
	"errors"
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) campusDocsIndexForAdmission(
	ctx context.Context,
) (*temporalruntime.CampusDocsIndexSnapshot, error) {
	if s.campusDocsIndexStore == nil {
		return nil, errors.New("campus docs index store is not configured")
	}
	index, found, err := s.campusDocsIndexStore.CurrentIndex(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve current Campus docs index: %w", err)
	}
	if !found {
		return nil, errors.New("campus docs current index is not available")
	}
	target := &temporalruntime.CampusDocsIndexSnapshot{
		Collection: index.Collection,
	}
	if err := validateCampusDocsIndexAdmission(target); err != nil {
		return nil, err
	}
	return target, nil
}

func validateCampusDocsIndexAdmission(target *temporalruntime.CampusDocsIndexSnapshot) error {
	if target == nil {
		return errors.New("campus docs index admission snapshot is required")
	}
	if err := campusdocs.ValidateIndex(campusdocs.Index{Collection: target.Collection}); err != nil {
		return errors.New("campus docs index admission snapshot is invalid")
	}
	return nil
}

func validateCampusDocsEmbeddingAdmission(
	target *temporalruntime.CampusDocsIndexSnapshot,
	provider providerconfig.RuntimeSetting,
) error {
	if err := validateCampusDocsIndexAdmission(target); err != nil {
		return err
	}
	if err := providerconfig.ValidateRuntimeSetting(provider, providerconfig.KindEmbedding); err != nil {
		return fmt.Errorf("active embedding setting is invalid: %w", err)
	}
	return nil
}
