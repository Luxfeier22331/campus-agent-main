package temporalruntime

import (
	"errors"
	"strings"
)

type TracingOptions struct {
	Enabled      bool
	OTelEndpoint string
	ServiceName  string
}

type TracingInterceptor struct {
	serviceName string
}

func NewTracingInterceptors(options TracingOptions) ([]TracingInterceptor, error) {
	if !options.Enabled {
		return nil, nil
	}
	if strings.TrimSpace(options.OTelEndpoint) == "" {
		return nil, errors.New("otel endpoint is required when temporal tracing is enabled")
	}
	serviceName := strings.TrimSpace(options.ServiceName)
	if serviceName == "" {
		serviceName = "campus-execution-control"
	}
	return []TracingInterceptor{{serviceName: serviceName}}, nil
}
