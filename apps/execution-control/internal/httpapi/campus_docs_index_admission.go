package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

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
		Collection:                index.Collection,
		DenseVectorName:           index.DenseVectorName,
		EmbeddingDimensions:       index.EmbeddingDimensions,
		EmbeddingQueryInstruction: index.EmbeddingQueryInstruction,
		EmbeddingSpaceID:          index.EmbeddingSpaceID,
		SparseModel:               index.SparseModel,
		SparseVectorName:          index.SparseVectorName,
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
	if !strings.HasPrefix(target.Collection, "campus_docs_") || target.DenseVectorName != "dense" ||
		target.SparseVectorName != "sparse" || target.SparseModel != "fnv1a_log_tf.v1" ||
		strings.TrimSpace(target.EmbeddingQueryInstruction) == "" ||
		strings.TrimSpace(target.EmbeddingSpaceID) == "" ||
		target.EmbeddingDimensions <= 0 {
		return errors.New("campus docs index admission snapshot is invalid")
	}
	return nil
}

func validateCampusDocsEmbeddingAdmission(
	target *temporalruntime.CampusDocsIndexSnapshot,
	provider providerConfigSnapshot,
) error {
	if err := validateCampusDocsIndexAdmission(target); err != nil {
		return err
	}
	if err := validateProviderConfigSnapshot(provider, providerConfigKindEmbedding); err != nil {
		return fmt.Errorf("active embedding setting is invalid: %w", err)
	}
	return nil
}
