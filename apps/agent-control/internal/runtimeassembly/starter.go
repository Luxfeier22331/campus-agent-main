package runtimeassembly

import (
	"context"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporalclient"
	"go.temporal.io/sdk/client"
)

func NewStarter(ctx context.Context, options temporalclient.StarterOptions) (*temporalclient.Starter, error) {
	if strings.TrimSpace(options.Address) == "" || strings.TrimSpace(options.Namespace) == "" {
		return nil, temporalclient.ErrTemporalStarterNotConfigured
	}
	sdk, err := client.NewLazyClient(client.Options{HostPort: strings.TrimSpace(options.Address), Namespace: strings.TrimSpace(options.Namespace)})
	if err != nil {
		return nil, err
	}
	starter, err := temporalclient.NewStarter(ctx, options, sdk)
	if err != nil {
		sdk.Close()
		return nil, err
	}
	return starter, nil
}
