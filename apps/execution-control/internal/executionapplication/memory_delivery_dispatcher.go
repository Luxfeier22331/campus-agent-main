package executionapplication

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"log/slog"
	"time"
)

type MemoryDeliveryStore interface {
	PendingMemoryDeliveries(context.Context) ([]memoryruntime.AppendConversationTurnRequest, error)
	AcknowledgeMemoryDelivery(context.Context, string) error
}
type MemoryAppendClient interface {
	Append(context.Context, memoryruntime.AppendConversationTurnRequest) error
}
type MemoryDeliveryDispatcher struct {
	Store  MemoryDeliveryStore
	Client MemoryAppendClient
}

func (d *MemoryDeliveryDispatcher) Once(ctx context.Context) error {
	requests, err := d.Store.PendingMemoryDeliveries(ctx)
	if err != nil {
		return err
	}
	for _, request := range requests {
		if err := d.Client.Append(ctx, request); err != nil {
			return err
		}
		if err := d.Store.AcknowledgeMemoryDelivery(ctx, request.RequestID); err != nil {
			return err
		}
	}
	return nil
}
func (d *MemoryDeliveryDispatcher) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := d.Once(ctx); err != nil && ctx.Err() == nil {
			slog.Error("memory append delivery failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
