package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/modelconfig"
)

func main() {
	var databaseURL, keyPath, legacyKeyPath string
	flag.StringVar(&databaseURL, "database-url", os.Getenv("MODEL_CONFIG_DATABASE_URL"), "database URL")
	flag.StringVar(&keyPath, "encryption-key-path", os.Getenv("MODEL_CONFIG_ENCRYPTION_KEY_FILE"), "new encryption key path")
	flag.StringVar(&legacyKeyPath, "legacy-encryption-key-path", os.Getenv("MODEL_CONFIG_LEGACY_ENCRYPTION_KEY_FILE"), "legacy encryption key path")
	flag.Parse()
	if strings.TrimSpace(databaseURL) == "" {
		var err error
		databaseURL, err = postgresURLFromEnvironment()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := modelconfig.Install(ctx, databaseURL, keyPath, legacyKeyPath); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func postgresURLFromEnvironment() (string, error) {
	host := strings.TrimSpace(os.Getenv("PGHOST"))
	database := strings.TrimSpace(os.Getenv("PGDATABASE"))
	user := strings.TrimSpace(os.Getenv("PGUSER"))
	password := os.Getenv("PGPASSWORD")
	if host == "" || database == "" || user == "" || password == "" {
		return "", fmt.Errorf("--database-url or PGHOST, PGDATABASE, PGUSER, and PGPASSWORD is required")
	}
	port := strings.TrimSpace(os.Getenv("PGPORT"))
	if port == "" {
		port = "5432"
	}
	databaseURL := &url.URL{
		Scheme: "postgresql",
		Host:   net.JoinHostPort(host, port),
		Path:   "/" + database,
		User:   url.UserPassword(user, password),
	}
	query := databaseURL.Query()
	if value := strings.TrimSpace(os.Getenv("PGSSLMODE")); value != "" {
		query.Set("sslmode", value)
	}
	if value := strings.TrimSpace(os.Getenv("PGSSLROOTCERT")); value != "" {
		query.Set("sslrootcert", value)
	}
	databaseURL.RawQuery = query.Encode()
	return databaseURL.String(), nil
}
