package activitysupport

import (
	"context"
	"time"

	"go.temporal.io/sdk/activity"
)

func RecordTemporalActivityHeartbeat(ctx context.Context, detail string) {
	if !activity.IsActivity(ctx) {
		return
	}
	activity.RecordHeartbeat(ctx, detail)
}

func StartTemporalActivityHeartbeat(
	ctx context.Context,
	detail string,
	interval time.Duration,
) func() {
	if !activity.IsActivity(ctx) {
		return func() {}
	}
	RecordTemporalActivityHeartbeat(ctx, detail)
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-stop:
				return
			case <-ticker.C:
				RecordTemporalActivityHeartbeat(ctx, detail)
			}
		}
	}()
	return func() { close(stop) }
}
