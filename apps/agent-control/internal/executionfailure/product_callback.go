package executionfailure

import (
	"errors"
)

func MapProductCallbackError(err error) error {
	if err == nil {
		return nil
	}
	var callbackErr interface {
		error
		ProductCallbackCode() string
	}
	if errors.As(err, &callbackErr) && callbackErr.ProductCallbackCode() != "" {
		return SanitizedError(
			callbackErr.ProductCallbackCode(),
			callbackErr,
			callbackErr.ProductCallbackCode() != "product_callback_unavailable",
		)
	}
	return SanitizedError("product_callback_unavailable", err, false)
}
