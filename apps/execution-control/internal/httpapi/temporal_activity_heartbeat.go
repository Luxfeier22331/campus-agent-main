package httpapi

import (
	"context"

	"go.temporal.io/sdk/activity"
)

func recordTemporalActivityHeartbeat(ctx context.Context, detail string) {
	if !activity.IsActivity(ctx) {
		return
	}
	activity.RecordHeartbeat(ctx, detail)
}
