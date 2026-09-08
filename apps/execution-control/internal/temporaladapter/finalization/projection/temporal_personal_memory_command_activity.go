package projection

import (
	"errors"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
)

func MapProductCallbackError(err error) error {
	if err == nil {
		return nil
	}
	var callbackErr *executionapplication.ProductCallbackError
	if errors.As(err, &callbackErr) && callbackErr.Code != "" {
		return SanitizedTemporalApplicationError(
			callbackErr.Code,
			callbackErr,
			callbackErr.Code != "product_callback_unavailable",
		)
	}
	return SanitizedTemporalApplicationError("product_callback_unavailable", err, false)
}
