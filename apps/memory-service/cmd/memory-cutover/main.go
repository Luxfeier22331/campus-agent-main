package main

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
	"log"
	"os"
)

func main() {
	source, target := os.Getenv("MEMORY_SOURCE_DATABASE_URL"), os.Getenv("MEMORY_DATABASE_URL")
	if source == "" || target == "" {
		log.Fatal("MEMORY_SOURCE_DATABASE_URL and MEMORY_DATABASE_URL are required")
	}
	if err := memorypersistence.CopyDrainedState(context.Background(), source, target); err != nil {
		log.Fatal(err)
	}
	log.Print("Memory lifecycle state copied; switch clients before resuming admission")
}
