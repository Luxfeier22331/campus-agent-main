package runtimeassembly

import (
	"context"
	"log/slog"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreconciler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/control"
)

type APIOwner struct {
	*resources
	server     *httpapi.Server
	reconciler *executionreconciler.Reconciler
}

func NewAPI(cfg config.Config, logger *slog.Logger) (*APIOwner, error) {
	r, err := newResources(cfg, logger)
	if err != nil {
		return nil, err
	}
	var client executionapplication.CampusSearchClient
	if cfg.RetrievalBaseURL != "" {
		campusSearchClient, campusSearchClientErr := outboundadapter.NewCampusSearchHTTPClient(
			cfg.RetrievalBaseURL,
			cfg.RetrievalInternalToken,
			time.Duration(cfg.CampusSearchTimeoutMS)*time.Millisecond,
		)
		if campusSearchClientErr != nil {
			return nil, campusSearchClientErr
		}
		client = campusSearchClient
	}
	reconciler := executionreconciler.New(executionreconciler.Options{
		Finalizer:        control.NewFinalizer(r.finalizationAdapter),
		Logger:           logger,
		OperationTimeout: time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		Starter:          &control.Gateway{Starter: r.temporalStarter},
		Store:            r.runProjectionStore,
	})
	runService := executionapplication.NewRunService(executionapplication.RunServiceOptions{
		AdmissionSnapshotBuilder:      r.admissionService,
		InputLoader:                   r.executionInputLoader,
		InputError:                    r.executionInputErr,
		Namespace:                     cfg.TemporalNamespace,
		PersonalMemoryRecallAvailable: r.personalMemoryExecutor != nil && r.personalMemoryErr == nil,
		PersonalMemoryTimeoutSeconds:  cfg.PersonalMemoryTimeoutSeconds,
		ReconcilerWaker:               reconciler,
		Store:                         r.runProjectionStore,
		StoreError:                    r.runProjectionStoreErr,
		TaskQueue:                     cfg.TemporalTaskQueue,
	})
	agentToolService := executionapplication.NewAgentToolService(executionapplication.AgentToolServiceOptions{
		CampusSearchClient:     client,
		InputLoader:            r.executionInputLoader,
		InputError:             r.executionInputErr,
		PersonalMemoryExecutor: r.personalMemoryExecutor,
		PersonalMemoryError:    r.personalMemoryErr,
		Store:                  r.runProjectionStore,
		StoreError:             r.runProjectionStoreErr,
	})
	server := httpapi.NewServerWithOptions(cfg, httpapi.ServerOptions{
		PersonalMemoryReader:     r.personalMemoryReader,
		AgentToolService:         agentToolService,
		Logger:                   logger,
		PersonalMemoryStateStore: r.personalMemoryStateStore,
		PersonalMemoryStateError: r.personalMemoryStateErr,
		RunProjectionStore:       r.runProjectionStore,
		RunProjectionStoreError:  r.runProjectionStoreErr,
		RunService:               runService,
		TemporalStarter:          &control.Gateway{Starter: r.temporalStarter},
		TemporalStarterError:     r.temporalStarterErr,
	})
	return &APIOwner{resources: r, server: server, reconciler: reconciler}, nil
}
func (owner *APIOwner) Handler() *httpapi.Server { return owner.server }
func (owner *APIOwner) Start(ctx context.Context) *executionreconciler.Reconciler {
	owner.reconciler.Start(ctx)
	return owner.reconciler
}
func (owner *APIOwner) StartDraining() { owner.server.StartDraining() }
func (owner *APIOwner) Shutdown(context.Context) error {
	owner.reconciler.Stop()
	owner.Close()
	return nil
}
