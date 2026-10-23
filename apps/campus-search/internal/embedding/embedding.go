// Package embedding owns query-vector generation and its exact, in-process cache.
// It has no dependency on execution, Temporal, index storage or model configuration.
package embedding

import (
	"context"
	"fmt"
	"math"
)

// Request describes the complete input and vector space, never credentials or an index.
// BaseURL is normalized by the provider adapter before it reaches the cache.
type Request struct {
	Input              string
	Provider           string
	BaseURL            string
	Model              string
	Dimensions         int
	InstructionVersion string
}

type Embedder interface {
	Embed(context.Context, Request) ([]float64, error)
}

func validate(vector []float64, dimensions int) error {
	if dimensions <= 0 || len(vector) != dimensions {
		return fmt.Errorf("embedding dimension = %d, want %d", len(vector), dimensions)
	}
	for index, value := range vector {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("embedding value %d is not finite", index)
		}
	}
	return nil
}
