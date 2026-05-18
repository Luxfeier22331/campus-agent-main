package structuredquery

import (
	"context"
	"errors"
	"sync"
)

type projectionReleaseStore interface {
	CurrentReleaseID(ctx context.Context) (string, error)
	LoadBundleForRelease(ctx context.Context, releaseID string) (projectionBundle, error)
}

type projectionBundleCache struct {
	mu        sync.Mutex
	releaseID string
	bundle    projectionBundle
}

func (r *Runtime) loadServiceStatusBundle(ctx context.Context) (projectionBundle, error) {
	if r.serviceStatusReadModelStore == nil {
		return projectionBundle{}, errors.New("service status read model store is not configured")
	}
	return loadProjectionBundleFromStore(
		ctx,
		r.serviceStatusReadModelStore,
		&r.serviceStatusBundleCache,
	)
}

func (r *Runtime) loadTransportScheduleBundle(ctx context.Context) (projectionBundle, error) {
	if r.transportScheduleReadModelStore == nil {
		return projectionBundle{}, errors.New("transport schedule read model store is not configured")
	}
	return loadProjectionBundleFromStore(
		ctx,
		r.transportScheduleReadModelStore,
		&r.transportScheduleBundleCache,
	)
}

func (r *Runtime) loadServiceGuideBundle(ctx context.Context) (projectionBundle, error) {
	if r.serviceGuideReadModelStore == nil {
		return projectionBundle{}, errors.New("service guide read model store is not configured")
	}
	return loadProjectionBundleFromStore(ctx, r.serviceGuideReadModelStore, &r.serviceGuideBundleCache)
}

func (r *Runtime) loadContactDirectoryBundle(ctx context.Context) (projectionBundle, error) {
	if r.contactDirectoryReadModelStore == nil {
		return projectionBundle{}, errors.New("contact directory read model store is not configured")
	}
	return loadProjectionBundleFromStore(
		ctx,
		r.contactDirectoryReadModelStore,
		&r.contactDirectoryBundleCache,
	)
}

func (r *Runtime) loadAcademicCalendarBundle(ctx context.Context) (projectionBundle, error) {
	if r.academicCalendarReadModelStore == nil {
		return projectionBundle{}, errors.New("academic calendar read model store is not configured")
	}
	return loadProjectionBundleFromStore(
		ctx,
		r.academicCalendarReadModelStore,
		&r.academicCalendarBundleCache,
	)
}

func loadProjectionBundleFromStore(
	ctx context.Context,
	store projectionReleaseStore,
	cache *projectionBundleCache,
) (projectionBundle, error) {
	if store == nil {
		return projectionBundle{}, errors.New("projection read model store is not configured")
	}
	releaseID, err := store.CurrentReleaseID(ctx)
	if err != nil {
		return projectionBundle{}, err
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if cache.releaseID == releaseID {
		return cache.bundle, nil
	}
	bundle, err := store.LoadBundleForRelease(ctx, releaseID)
	if err != nil {
		return projectionBundle{}, err
	}
	cache.releaseID = releaseID
	cache.bundle = bundle
	return bundle, nil
}
