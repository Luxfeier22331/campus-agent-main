package main

import "github.com/MUC-WIKI/campus-agent/apps/execution-control/cmd/internal/workermain"

func main() {
	workermain.Run(workermain.RoleCore)
}
