package temporalruntime

import (
	"errors"
	"strings"

	"go.temporal.io/sdk/client"
	temporalotel "go.temporal.io/sdk/contrib/opentelemetry"
	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/worker"
)

type TracingOptions struct {
	Enabled      bool
	OTelEndpoint string
	ServiceName  string
}

type TracingInterceptors struct {
	Client []interceptor.ClientInterceptor
	Worker []interceptor.WorkerInterceptor
}

func NewTracingInterceptors(options TracingOptions) (TracingInterceptors, error) {
	if !options.Enabled {
		return TracingInterceptors{}, nil
	}
	if strings.TrimSpace(options.OTelEndpoint) == "" {
		return TracingInterceptors{}, errors.New("otel endpoint is required when temporal tracing is enabled")
	}
	tracingInterceptor, err := temporalotel.NewTracingInterceptor(temporalotel.TracerOptions{})
	if err != nil {
		return TracingInterceptors{}, err
	}
	return TracingInterceptors{
		Client: []interceptor.ClientInterceptor{tracingInterceptor},
		Worker: []interceptor.WorkerInterceptor{tracingInterceptor},
	}, nil
}

func ApplyTracingToClientOptions(
	options client.Options,
	tracing TracingInterceptors,
) client.Options {
	if len(tracing.Client) == 0 {
		return options
	}
	options.Interceptors = append(options.Interceptors, tracing.Client...)
	return options
}

func ApplyTracingToWorkerOptions(
	options worker.Options,
	tracing TracingInterceptors,
) worker.Options {
	if len(tracing.Worker) == 0 {
		return options
	}
	options.Interceptors = append(options.Interceptors, tracing.Worker...)
	return options
}
