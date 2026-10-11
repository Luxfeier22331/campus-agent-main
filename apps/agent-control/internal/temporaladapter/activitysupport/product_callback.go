package activitysupport

import "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"

func MapProductCallbackError(err error) error {
	return MapApplicationError(executionfailure.MapProductCallbackError(err))
}
