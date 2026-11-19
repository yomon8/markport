package server

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/markport/markport/internal/discovery"
	"github.com/markport/markport/internal/gitdiff"
)

func (s *Server) instanceRecord() discovery.Record {
	return discovery.Record{ID: s.instance, PID: os.Getpid(), Host: s.Host, Port: s.Port}
}

// RegisterInstance is called before serving requests and returns shutdown cleanup.
func (s *Server) RegisterInstance() (func(), error) {
	registry, err := discovery.Default()
	s.Registry = registry
	if err == nil {
		var cleanup func()
		cleanup, err = registry.Register(s.instanceRecord())
		if err == nil {
			return cleanup, nil
		}
	}
	s.DiscoveryError = "Cannot register this Markport for discovery."
	return nil, err
}

func (s *Server) instanceInfo(ctx context.Context, includeBranch bool) discovery.Info {
	info := discovery.Info{RootPath: s.Files.Path, Version: s.Version}
	if includeBranch {
		// Leave time for the discovery probe to receive a reply even when Git is slow.
		ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
		defer cancel()
		info.Branch = gitdiff.Branch(ctx, s.Files.Path)
	}
	return info
}

func (s *Server) serverInfo(w http.ResponseWriter, r *http.Request) {
	info := s.instanceInfo(r.Context(), true)
	instances := []discovery.Instance{discovery.Link(s.instanceRecord(), info, true, r.Host)}
	discoveryError := s.DiscoveryError
	if s.Registry != nil {
		var err error
		instances, err = s.Registry.List(r.Context(), s.instanceRecord(), info, r.Host)
		if err != nil {
			discoveryError = "Cannot load the complete server list. Please try again."
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	jsonReply(w, http.StatusOK, struct {
		discovery.Info
		WorkingDirectory string               `json:"workingDirectory"`
		Instances        []discovery.Instance `json:"instances"`
		InstancesError   string               `json:"instancesError,omitempty"`
	}{info, s.WorkingDirectory, instances, discoveryError})
}
