package executionapplication

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

const (
	defaultAgentDeadlineMS        = 90000
	defaultAgentMaxOutputTokens   = 2048
	defaultAgentCurrentInputChars = 8000
	defaultAgentContextChars      = 16000
)

type AdmissionOptions struct {
	AgentDeadlineMS            int
	ContextCharLimit           int
	CurrentInputCharLimit      int
	MaxOutputTokens            int
	PrimaryAgentTargetResolver execution.PrimaryAgentTargetResolver
	PrimaryAgentTargetError    error
	ToolFunctionSchemaPath     string
	ToolRegistryPath           string
}

type AdmissionService struct {
	limits                     execution.AgentRuntimeLimitsSnapshot
	primaryAgentTargetResolver execution.PrimaryAgentTargetResolver
	primaryAgentTargetError    error
	toolFunctionSchemaPath     string
	toolRegistryPath           string
}

func NewAdmissionService(options AdmissionOptions) *AdmissionService {
	return &AdmissionService{
		limits: execution.AgentRuntimeLimitsSnapshot{
			AgentDeadlineMS:       positiveOrDefault(options.AgentDeadlineMS, defaultAgentDeadlineMS),
			ContextCharLimit:      positiveOrDefault(options.ContextCharLimit, defaultAgentContextChars),
			CurrentInputCharLimit: positiveOrDefault(options.CurrentInputCharLimit, defaultAgentCurrentInputChars),
			MaxOutputTokens:       positiveOrDefault(options.MaxOutputTokens, defaultAgentMaxOutputTokens),
		},
		primaryAgentTargetResolver: options.PrimaryAgentTargetResolver,
		primaryAgentTargetError:    options.PrimaryAgentTargetError,
		toolFunctionSchemaPath:     strings.TrimSpace(options.ToolFunctionSchemaPath),
		toolRegistryPath:           strings.TrimSpace(options.ToolRegistryPath),
	}
}

func (s *AdmissionService) BuildAgentAdmissionSnapshot(
	ctx context.Context,
	personalMemoryRecallAvailable bool,
) (execution.AgentAdmissionSnapshot, error) {
	if s == nil {
		return execution.AgentAdmissionSnapshot{}, execution.NewDependencyNotReadyError(
			errors.New("agent admission service is not configured"),
		)
	}
	strategy := execution.ExecutionStrategyForAdmission(personalMemoryRecallAvailable)
	toolContract, err := buildToolContractFingerprint(s.toolRegistryPath, s.toolFunctionSchemaPath)
	if err != nil {
		return execution.AgentAdmissionSnapshot{}, execution.NewDependencyNotReadyError(
			fmt.Errorf("build tool contract admission snapshot: %w", err),
		)
	}
	snapshot := execution.AgentAdmissionSnapshot{
		AgentLimits:                   s.limits,
		AgentLimitsSHA256:             execution.HashAdmissionJSON(s.limits),
		ExecutionStrategy:             strategy,
		ExecutionStrategySHA256:       execution.HashAdmissionJSON(strategy),
		ToolContractFingerprint:       toolContract,
		ToolContractFingerprintSHA256: execution.HashAdmissionJSON(toolContract),
	}
	target, err := s.resolvePrimaryAgentTarget(ctx)
	if err != nil {
		return execution.AgentAdmissionSnapshot{}, execution.NewDependencyNotReadyError(
			fmt.Errorf("resolve primary agent model target: %w", err),
		)
	}
	snapshot.PrimaryAgentTargetSHA256 = target.TargetSHA256
	if err := execution.ValidateAdmissionSnapshotForVisibleTools(
		snapshot,
		strategy.VisibleFunctionToolNames,
	); err != nil {
		return execution.AgentAdmissionSnapshot{}, err
	}
	return snapshot, nil
}

func (s *AdmissionService) ValidateWorkflowAdmission(
	snapshot execution.AgentAdmissionSnapshot,
	visibleFunctionToolNames []string,
) error {
	return execution.ValidateAdmissionSnapshotForVisibleTools(snapshot, visibleFunctionToolNames)
}

func (s *AdmissionService) ValidateLocalToolContractFingerprint(
	expected execution.ToolContractFingerprintSnapshot,
) error {
	if s == nil {
		return errors.New("agent admission service is not configured")
	}
	local, err := buildToolContractFingerprint(s.toolRegistryPath, s.toolFunctionSchemaPath)
	if err != nil {
		return fmt.Errorf("build local tool contract fingerprint: %w", err)
	}
	if err := execution.ValidateAgentRuntimeToolContract(
		expected,
		execution.ToolContractFingerprintSnapshotMap(local),
	); err != nil {
		return fmt.Errorf("local execution-control tool contract fingerprint: %w", err)
	}
	return nil
}

func (s *AdmissionService) ValidateLocalToolContractFingerprintMap(expected map[string]any) error {
	if len(expected) == 0 {
		return errors.New("admitted tool contract fingerprint is unavailable")
	}
	if s == nil {
		return errors.New("agent admission service is not configured")
	}
	local, err := buildToolContractFingerprint(s.toolRegistryPath, s.toolFunctionSchemaPath)
	if err != nil {
		return fmt.Errorf("build local tool contract fingerprint: %w", err)
	}
	if execution.HashAdmissionJSON(expected) !=
		execution.HashAdmissionJSON(execution.ToolContractFingerprintSnapshotMap(local)) {
		return errors.New("local execution-control tool contract fingerprint does not match admission")
	}
	return nil
}

func (s *AdmissionService) resolvePrimaryAgentTarget(ctx context.Context) (execution.PrimaryAgentTarget, error) {
	if s.primaryAgentTargetError != nil {
		return execution.PrimaryAgentTarget{}, s.primaryAgentTargetError
	}
	if s.primaryAgentTargetResolver == nil {
		return execution.PrimaryAgentTarget{}, errors.New("primary agent model target resolver is not configured")
	}
	return s.primaryAgentTargetResolver.ResolvePrimaryAgentTarget(ctx)
}

func positiveOrDefault(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}
