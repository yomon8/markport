package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"text/tabwriter"

	"github.com/markport/markport/internal/discovery"
)

type serverSummary struct {
	RootPath string `json:"rootPath"`
	URL      string `json:"url"`
	Version  string `json:"version"`
}

func listServers(ctx context.Context, registry *discovery.Registry, asJSON bool, stdout, stderr io.Writer) int {
	instances, err := registry.Discover(ctx)
	if err != nil {
		fmt.Fprintf(stderr, "Cannot list running Markport servers: %v\n", err)
		return 1
	}
	if err := printServers(instances, asJSON, stdout); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

func printServers(instances []discovery.Instance, asJSON bool, stdout io.Writer) error {
	if asJSON {
		summaries := make([]serverSummary, 0, len(instances))
		for _, instance := range instances {
			summaries = append(summaries, serverSummary{RootPath: instance.RootPath, URL: instance.URL, Version: instance.Version})
		}
		return json.NewEncoder(stdout).Encode(summaries)
	}
	if len(instances) == 0 {
		_, err := fmt.Fprintln(stdout, "No running Markport servers found.")
		return err
	}
	writer := tabwriter.NewWriter(stdout, 0, 4, 2, ' ', 0)
	if _, err := fmt.Fprintln(writer, "URL\tVERSION\tDIRECTORY"); err != nil {
		return err
	}
	// Keep each server on one row even when a path contains tabs or newlines.
	escape := strings.NewReplacer("\t", "\\t", "\r", "\\r", "\n", "\\n")
	for _, instance := range instances {
		if _, err := fmt.Fprintf(writer, "%s\t%s\t%s\n", escape.Replace(instance.URL), escape.Replace(instance.Version), escape.Replace(instance.RootPath)); err != nil {
			return err
		}
	}
	return writer.Flush()
}
