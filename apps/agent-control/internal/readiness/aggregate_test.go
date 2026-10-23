package readiness

import (
	"context"
	"testing"
)

func TestAggregateRequiresEveryDependencyToBeHealthy(t *testing.T) {
	ctx := context.Background()
	if !Aggregate(ctx, func(context.Context) map[string]any { return map[string]any{"healthy": true} }) {
		t.Fatal("healthy dependency set reported degraded")
	}
	if Aggregate(ctx,
		func(context.Context) map[string]any { return map[string]any{"healthy": true} },
		func(context.Context) map[string]any { return map[string]any{"healthy": false} },
	) {
		t.Fatal("degraded dependency set reported ready")
	}
}

func TestAggregateRejectsMissingCheck(t *testing.T) {
	if Aggregate(context.Background(), nil) {
		t.Fatal("missing dependency check reported ready")
	}
}
