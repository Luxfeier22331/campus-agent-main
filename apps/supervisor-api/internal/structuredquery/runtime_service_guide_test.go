package structuredquery

import (
	"context"
	"testing"
)

func newRuntimeWithServiceGuideReadModel(
	t *testing.T,
	payload string,
	trustedTime string,
) *Runtime {
	t.Helper()
	return NewRuntime(Options{
		ServiceGuideReadModelStore: &fakeServiceGuideReadModelStore{
			bundle: mustProjectionBundle(t, payload),
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

type fakeServiceGuideReadModelStore struct {
	releaseID          string
	bundle             projectionBundle
	loadCount          int
	loadedReleaseIDs   []string
	projectionReady    bool
	projectionReadySet bool
	projectionReadyErr error
}

func (s fakeServiceGuideReadModelStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeServiceGuideReadModelStore) CurrentReleaseID(context.Context) (string, error) {
	if s.releaseID == "" {
		return "service-guide-release-1", nil
	}
	return s.releaseID, nil
}

func (s *fakeServiceGuideReadModelStore) ProjectionReady(context.Context) (bool, error) {
	if s.projectionReadyErr != nil {
		return false, s.projectionReadyErr
	}
	if s.projectionReadySet {
		return s.projectionReady, nil
	}
	return len(s.bundle.ServiceGuideRecords) > 0, nil
}

func (s *fakeServiceGuideReadModelStore) LoadBundleForRelease(
	_ context.Context,
	releaseID string,
) (projectionBundle, error) {
	s.loadCount++
	s.loadedReleaseIDs = append(s.loadedReleaseIDs, releaseID)
	return s.bundle, nil
}
