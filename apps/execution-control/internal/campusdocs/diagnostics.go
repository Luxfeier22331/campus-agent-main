package campusdocs

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdiagnostics"
)

type SearchObserver struct {
	Snapshot *campusdiagnostics.Snapshot
	Phase    func(string)
}
type searchObserverKey struct{}

func WithSearchObserver(ctx context.Context, observer *SearchObserver) context.Context {
	return context.WithValue(ctx, searchObserverKey{}, observer)
}

func SearchObservation(ctx context.Context) *SearchObserver {
	if observer, ok := ctx.Value(searchObserverKey{}).(*SearchObserver); ok {
		return observer
	}
	return &SearchObserver{Snapshot: &campusdiagnostics.Snapshot{Durations: map[string]int64{}}, Phase: func(string) {}}
}
