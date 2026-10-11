package readiness

import "context"

type Check func(context.Context) map[string]any

// Aggregate evaluates the required dependency health without knowing how a
// dependency is represented or checked.
func Aggregate(ctx context.Context, checks ...Check) bool {
	for _, check := range checks {
		if check == nil {
			return false
		}
		status := check(ctx)
		if status["healthy"] != true {
			return false
		}
	}
	return true
}
