package httpapi

import (
	"context"
	"time"

	"go.temporal.io/sdk/activity"
)

func recordTemporalActivityHeartbeat(ctx context.Context, detail string) {
	if !activity.IsActivity(ctx) {
		return
	}
	activity.RecordHeartbeat(ctx, detail)
}

func startTemporalActivityHeartbeat(
	ctx context.Context,
	detail string,
	interval time.Duration,
) func() {
	if !activity.IsActivity(ctx) {
		return func() {}
	}
	recordTemporalActivityHeartbeat(ctx, detail)
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
				recordTemporalActivityHeartbeat(ctx, detail)
			}
		}
	}()
	return func() { close(stop) }
}
