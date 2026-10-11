package finalization

import (
	"errors"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"
)

func FixedTemporalFailureError(kind string) error {
	return errors.New(executionfailure.PublicMessage(kind))
}
