package contracts_test

import (
	"bytes"
	"encoding/json"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/agentruntimeprotocol"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"os"
	"path/filepath"
	"testing"
)

func TestRuntimeControlSharedFixtures(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..", "packages", "contracts")
	raw, err := os.ReadFile(filepath.Join(root, "schemas", "agent-runtime-control.v1.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	var document any
	if err = json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	compiler := jsonschema.NewCompiler()
	const url = "https://campus-agent.invalid/contracts/agent-runtime-control.v1"
	if err = compiler.AddResource(url, document); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(filepath.Join(root, "fixtures", "agent-runtime-control.v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name, Schema string
		Valid        bool
		Value        json.RawMessage
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			schema, err := compiler.Compile(url + "#/$defs/" + fixture.Schema)
			if err != nil {
				t.Fatal(err)
			}
			var value any
			if err = json.Unmarshal(fixture.Value, &value); err != nil {
				t.Fatal(err)
			}
			err = schema.Validate(value)
			if (err == nil) != fixture.Valid {
				t.Fatalf("valid=%v: %v", fixture.Valid, err)
			}
			if fixture.Valid {
				var typed any
				switch fixture.Schema {
				case "ActivityMetadata":
					typed = &executioncontract.ActivityMetadata{}
				case "AgentRuntimeResponse":
					typed = &agentruntimeprotocol.AgentRuntimeResponse{}
				default:
					return
				}
				decoder := json.NewDecoder(bytes.NewReader(fixture.Value))
				decoder.DisallowUnknownFields()
				if err = decoder.Decode(typed); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
