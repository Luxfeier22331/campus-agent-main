//go:build !retired_pg_lease

package main

import (
	"fmt"
	"os"
)

// durable-runtime-proof is a retired PG lease proof command.
//
// The default execution-control build uses Temporal as execution truth and PG
// only as sanitized run projection truth. The historical proof implementation
// remains available only with the retired_pg_lease build tag for migration
// audits, not for online serving or staging closeout.

func main() {
	_, _ = fmt.Fprintln(
		os.Stderr,
		"durable-runtime-proof is retired; use temporal-runtime-http-proof for active staging closeout",
	)
	os.Exit(2)
}
