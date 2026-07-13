package toolreadmodel

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

func (r *Runtime) loadTransportScheduleBundle(ctx context.Context) (projectionBundle, error) {
	if r.transportScheduleReadModelStore == nil {
		return projectionBundle{}, errors.New("transport schedule read model store is not configured")
	}
	bundle, err := loadProjectionBundleFromStore(
		ctx,
		r.transportScheduleReadModelStore,
		&r.transportScheduleBundleCache,
	)
	if err != nil {
		return projectionBundle{}, err
	}
	return bundle, nil
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
