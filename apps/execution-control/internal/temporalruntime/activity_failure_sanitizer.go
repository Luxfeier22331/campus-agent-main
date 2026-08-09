package temporalruntime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/temporal"
)

const (
	sanitizedActivityFailureMessage = "Activity failed before completion."
	sanitizedActivityFailureType    = "activity_failed"
)

var temporalErrorTypePattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)

// ActivityFailureSanitizer is installed on every activity worker. Temporal's
// default conversion of a plain Go error preserves Error() in workflow history;
// this boundary retains retryability and known Temporal control errors while
// replacing that unbounded message with a fixed envelope.
type ActivityFailureSanitizer struct {
	interceptor.WorkerInterceptorBase
}

func (i *ActivityFailureSanitizer) InterceptActivity(
	ctx context.Context,
	next interceptor.ActivityInboundInterceptor,
) interceptor.ActivityInboundInterceptor {
	return &activityFailureSanitizerInbound{
		ActivityInboundInterceptorBase: interceptor.ActivityInboundInterceptorBase{Next: next},
	}
}

type activityFailureSanitizerInbound struct {
	interceptor.ActivityInboundInterceptorBase
}

func (i *activityFailureSanitizerInbound) Init(outbound interceptor.ActivityOutboundInterceptor) error {
	return i.ActivityInboundInterceptorBase.Init(outbound)
}

func (i *activityFailureSanitizerInbound) ExecuteActivity(
	ctx context.Context,
	in *interceptor.ExecuteActivityInput,
) (interface{}, error) {
	result, err := i.ActivityInboundInterceptorBase.ExecuteActivity(ctx, in)
	return result, sanitizeActivityFailure(err)
}

func sanitizeActivityFailure(err error) error {
	if err == nil || isTemporalControlFailure(err) {
		return err
	}

	var applicationError *temporal.ApplicationError
	if errors.As(err, &applicationError) {
		return sanitizedApplicationError(applicationError)
	}

	sum := sha256.Sum256([]byte(err.Error()))
	return temporal.NewApplicationError(
		sanitizedActivityFailureMessage,
		sanitizedActivityFailureType,
		hex.EncodeToString(sum[:]),
	)
}

func isTemporalControlFailure(err error) bool {
	return temporal.IsCanceledError(err) ||
		errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, activity.ErrResultPending)
}

func sanitizedApplicationError(err *temporal.ApplicationError) error {
	errorType := err.Type()
	if !temporalErrorTypePattern.MatchString(errorType) {
		errorType = sanitizedActivityFailureType
	}
	options := temporal.ApplicationErrorOptions{
		Category:       err.Category(),
		NextRetryDelay: err.NextRetryDelay(),
		NonRetryable:   err.NonRetryable(),
	}
	var detail string
	if err.Details(&detail) == nil && validFailureHash(detail) {
		options.Details = []interface{}{detail}
	}
	return temporal.NewApplicationErrorWithOptions(
		sanitizedActivityFailureMessage,
		errorType,
		options,
	)
}
