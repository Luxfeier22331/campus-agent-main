package structuredquery

import (
	"context"
	"encoding/json"
	"testing"
)

func newRuntimeWithTransportReadModel(
	t *testing.T,
	payload string,
	trustedTime string,
) *Runtime {
	t.Helper()
	return NewRuntime(Options{
		TransportScheduleReadModelStore: &fakeTransportScheduleReadModelStore{
			bundle: mustProjectionBundle(t, payload),
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

func newRuntimeWithServiceStatusReadModel(
	t *testing.T,
	payload string,
	trustedTime string,
) *Runtime {
	t.Helper()
	return NewRuntime(Options{
		ServiceStatusReadModelStore: &fakeServiceStatusReadModelStore{
			bundle: mustProjectionBundle(t, payload),
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

type fakeTransportScheduleReadModelStore struct {
	releaseID          string
	bundle             projectionBundle
	loadCount          int
	projectionReady    bool
	projectionReadySet bool
	projectionReadyErr error
}

func (s fakeTransportScheduleReadModelStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeTransportScheduleReadModelStore) CurrentReleaseID(context.Context) (string, error) {
	if s.releaseID == "" {
		return "transport-release-1", nil
	}
	return s.releaseID, nil
}

func (s *fakeTransportScheduleReadModelStore) ProjectionReady(context.Context) (bool, error) {
	if s.projectionReadyErr != nil {
		return false, s.projectionReadyErr
	}
	if s.projectionReadySet {
		return s.projectionReady, nil
	}
	return len(s.bundle.TransportScheduleSnapshots) > 0, nil
}

func (s *fakeTransportScheduleReadModelStore) LoadBundleForRelease(
	_ context.Context,
	_ string,
) (projectionBundle, error) {
	s.loadCount++
	return s.bundle, nil
}

type fakeServiceStatusReadModelStore struct {
	releaseID          string
	bundle             projectionBundle
	loadCount          int
	projectionReady    bool
	projectionReadySet bool
	projectionReadyErr error
}

func (s fakeServiceStatusReadModelStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeServiceStatusReadModelStore) CurrentReleaseID(context.Context) (string, error) {
	if s.releaseID == "" {
		return "service-status-release-1", nil
	}
	return s.releaseID, nil
}

func (s *fakeServiceStatusReadModelStore) ProjectionReady(context.Context) (bool, error) {
	if s.projectionReadyErr != nil {
		return false, s.projectionReadyErr
	}
	if s.projectionReadySet {
		return s.projectionReady, nil
	}
	return len(s.bundle.ServiceStatusRecords) > 0, nil
}

func (s *fakeServiceStatusReadModelStore) LoadBundleForRelease(
	context.Context,
	string,
) (projectionBundle, error) {
	s.loadCount++
	return s.bundle, nil
}

func mustProjectionBundle(t *testing.T, payload string) projectionBundle {
	t.Helper()
	var bundle projectionBundle
	if err := json.Unmarshal([]byte(payload), &bundle); err != nil {
		t.Fatalf("decode projection bundle: %v", err)
	}
	return bundle
}
