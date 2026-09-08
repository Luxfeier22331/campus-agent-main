package finalization

import (
	"errors"

	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
)

func FixedTemporalFailureError(kind string) error {
	return errors.New(activityprojection.TemporalFailurePublicMessage(kind))
}
