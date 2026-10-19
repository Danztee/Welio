// Command welio runs the Welio Go API and its migration commands.
package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/danztee/welio/internal/app"
	"github.com/danztee/welio/internal/config"
	"github.com/danztee/welio/internal/db"
)

var version = "dev"

func main() {
	root := &cobra.Command{
		Use:           "welio",
		Short:         "Welio backend API and workers",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.AddCommand(serveCommand(), migrateCommand(), healthcheckCommand(), &cobra.Command{
		Use: "version", Run: func(*cobra.Command, []string) { fmt.Println(version) },
	})
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func serveCommand() *cobra.Command {
	command := &cobra.Command{
		Use:   "serve",
		Short: "Run the API and worker process",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := config.Load(os.Getenv)
			if err != nil {
				return err
			}
			role, err := cmd.Flags().GetString("role")
			if err != nil {
				return fmt.Errorf("read role flag: %w", err)
			}
			if role != "" {
				cfg.Role = role
			}
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			log := app.NewLogger(cfg)
			dependencies, cleanup, err := app.Build(ctx, cfg, log)
			if err != nil {
				return err
			}
			defer cleanup()
			return app.Serve(ctx, dependencies)
		},
	}
	command.Flags().String("role", "", "override WELIO_ROLE (all, api, or worker)")
	return command
}

func migrateCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "migrate",
		Short: "Apply SQL migrations to the Welio database",
		RunE: func(*cobra.Command, []string) error {
			databaseURL, err := migrationDatabaseURL(os.Getenv)
			if err != nil {
				return err
			}
			if err := db.Migrate(context.Background(), databaseURL); err != nil {
				return err
			}
			fmt.Println("database migrations are current")
			return nil
		},
	}
}

func migrationDatabaseURL(getenv func(string) string) (string, error) {
	databaseURL := strings.TrimSpace(getenv("DATABASE_URL_DIRECT"))
	if databaseURL == "" {
		databaseURL = strings.TrimSpace(getenv("DATABASE_URL"))
	}
	if databaseURL == "" {
		return "", errors.New("DATABASE_URL is required")
	}
	return databaseURL, nil
}

func healthcheckCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "healthcheck",
		Short: "Exit successfully when the local HTTP process answers /healthz",
		RunE: func(*cobra.Command, []string) error {
			addr := strings.TrimSpace(os.Getenv("HTTP_ADDR"))
			if addr == "" {
				addr = ":8081"
			}
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return fmt.Errorf("parse HTTP_ADDR: %w", err)
			}
			if host == "" {
				host = "127.0.0.1"
			}
			client := &http.Client{Timeout: 3 * time.Second}
			request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "http://"+net.JoinHostPort(host, port)+"/healthz", nil)
			if err != nil {
				return err
			}
			response, err := client.Do(request)
			if err != nil {
				return err
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				return fmt.Errorf("healthcheck returned status %d", response.StatusCode)
			}
			return nil
		},
	}
}
