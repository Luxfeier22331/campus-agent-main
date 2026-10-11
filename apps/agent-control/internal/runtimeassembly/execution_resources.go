package runtimeassembly

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	finalizationapp "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/finalization"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioninput"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/modelconfigclient"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporaladapter/answermemory"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporaladapter/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/toolcontract"
)

type executionResources struct {
	store        executionapplication.RunStore
	storeErr     error
	admission    *executionapplication.AdmissionService
	inputReader  *executionapplication.InputReader
	writer       *projection.Writer
	finalization *finalizationapp.FinalizationService
}

func newExecutionResources(ctx context.Context, cfg config.Config, logger *slog.Logger, productCallbackClient executionapplication.ExecutionFinalizationClient) executionResources {
	runProjectionStore, runProjectionStoreErr := newRunProjectionStore(ctx, cfg)

	var modelConfigResolver *modelconfigclient.Client
	var modelConfigErr error
	if strings.TrimSpace(cfg.ModelConfigBaseURL) != "" {
		modelConfigResolver, modelConfigErr = modelconfigclient.New(cfg.ModelConfigBaseURL)
	} else {
		modelConfigErr = modelconfigclient.ErrNotConfigured
	}

	admissionService := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ToolContract:          toolcontract.Files{},
		AgentDeadlineMS:       cfg.AgentRuntimeDeadlineMS,
		ContextCharLimit:      cfg.AgentRuntimeContextCharLimit,
		CurrentInputCharLimit: cfg.AgentRuntimeInputCharLimit,
		MaxOutputTokens:       cfg.AgentRuntimeMaxOutputTokens,
		ModelTargetResolver:   modelConfigResolver,
		ModelTargetError:      modelConfigErr,
	})
	executionInputLoader, executionInputErr := executioninput.NewInputLoader(cfg)

	writer := projection.New(projection.Writer{WorkerID: cfg.TemporalWorkerIdentity, RunProjectionStore: runProjectionStore})
	inputReader := &executionapplication.InputReader{ExecutionInputLoader: executionInputLoader, ExecutionInputErr: executionInputErr}
	finalizationAdapter := finalizationapp.New(finalizationapp.FinalizationService{StateWriter: runProjectionStore, Writer: writer.Application(ctx), FinalizationClient: productCallbackClient, AdmissionService: admissionService, Logger: logger})
	if cfg.MemoryServiceBaseURL != "" {
		if store, ok := runProjectionStore.(*executionpersistence.PostgresRunProjectionStore); ok {
			finalizationAdapter.PrepareMemoryDelivery = func(ctx context.Context, run execution.DurableRun) error {
				payload, err := inputReader.LoadExecutionPayload(ctx, run)
				if err != nil {
					return err
				}
				enabled, known := answermemory.MemoryEnabledFromExecutionPayload(payload)
				if !known || !enabled {
					return nil
				}
				request, err := answermemory.MemoryAppendRequestForRun(run, payload)
				if err != nil {
					return err
				}
				return store.PrepareMemoryDelivery(ctx, run.OwnerUserID, request)
			}
		}
	}
	return executionResources{
		store: runProjectionStore, storeErr: runProjectionStoreErr,
		admission: admissionService, inputReader: inputReader, writer: writer, finalization: finalizationAdapter,
	}
}

func newRunProjectionStore(ctx context.Context, cfg config.Config) (executionapplication.RunStore, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return nil, nil
	}
	connectCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	store, err := executionpersistence.NewPostgresRunProjectionStore(connectCtx, executionpersistence.PostgresRunProjectionStoreOptions{
		DatabaseURL: strings.TrimSpace(cfg.DatabaseURL),
	})
	if err != nil {
		return nil, err
	}
	return store, nil
}
