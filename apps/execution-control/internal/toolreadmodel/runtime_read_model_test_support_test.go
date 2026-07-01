package toolreadmodel

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

type fakeTransportScheduleReadModelStore struct {
	releaseID          string
	bundle             projectionBundle
	loadCount          int
	enrichURLs         bool
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

func (s *fakeTransportScheduleReadModelStore) EnrichTransportReleaseNoticeURLs(
	_ context.Context,
	bundle projectionBundle,
) (projectionBundle, error) {
	if !s.enrichURLs {
		return bundle, nil
	}
	for index := range bundle.TransportReleaseNotices {
		if bundle.TransportReleaseNotices[index].normalizedSourceNoticeID() == "355867" {
			bundle.TransportReleaseNotices[index].SourceURL = "https://portal.example.edu/#/print?type=5&notice_id=355867&show_type=1"
		}
	}
	return bundle, nil
}

type fakeCampusServicesOpsReleaseStore struct {
	release            campusServicesOpsRelease
	loadCount          int
	latestErr          error
	projectionReady    bool
	projectionReadySet bool
	projectionReadyErr error
}

func (s fakeCampusServicesOpsReleaseStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeCampusServicesOpsReleaseStore) LatestPublishedRelease(
	context.Context,
) (campusServicesOpsRelease, error) {
	s.loadCount++
	if s.latestErr != nil {
		return campusServicesOpsRelease{}, s.latestErr
	}
	return normalizeCampusServicesOpsRelease(s.release), nil
}

func (s *fakeCampusServicesOpsReleaseStore) ProjectionReady(context.Context) (bool, error) {
	if s.projectionReadyErr != nil {
		return false, s.projectionReadyErr
	}
	if s.projectionReadySet {
		return s.projectionReady, nil
	}
	return s.release.ReleaseID != "", nil
}

func mustProjectionBundle(t *testing.T, payload string) projectionBundle {
	t.Helper()
	var bundle projectionBundle
	if err := json.Unmarshal([]byte(payload), &bundle); err != nil {
		t.Fatalf("decode projection bundle: %v", err)
	}
	return bundle
}
