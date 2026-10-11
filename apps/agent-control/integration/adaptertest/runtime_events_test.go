package adaptertest

import (
	"io"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/outboundadapter"
)

func runtimeEvents(body io.Reader) func(func(executionapplication.AgentRuntimeEvent) error) error {
	return func(handle func(executionapplication.AgentRuntimeEvent) error) error {
		return outboundadapter.ReadRuntimeEvents(body, handle)
	}
}
