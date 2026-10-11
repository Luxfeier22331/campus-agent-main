package activitysupport

import (
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"
	"go.temporal.io/sdk/temporal"
)

func MapApplicationError(err error) error {
	var app *executionfailure.Error
	if !errors.As(err, &app) {
		return err
	}
	if app.Details != nil {
		if app.Permanent {
			return temporal.NewNonRetryableApplicationError(app.Message, app.Code, nil, app.Details)
		}
		return temporal.NewApplicationErrorWithCause(app.Message, app.Code, nil, app.Details)
	}
	if app.Permanent {
		return temporal.NewNonRetryableApplicationError(app.Message, app.Code, nil)
	}
	return temporal.NewApplicationError(app.Message, app.Code)
}
