package embedding

import "context"

// CacheObservation describes this caller, not the shared provider request.
type CacheObservation struct {
	Outcome          string
	WaitMs           int64
	EstimatedSavedMs int64
}

type observationKey struct{}

func WithObservation(ctx context.Context, observe func(CacheObservation)) context.Context {
	return context.WithValue(ctx, observationKey{}, observe)
}

func observeCache(ctx context.Context, observation CacheObservation) {
	if observe, ok := ctx.Value(observationKey{}).(func(CacheObservation)); ok {
		observe(observation)
	}
}
