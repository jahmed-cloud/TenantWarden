// Package monitor holds what the agent watches beyond its built-in collectors: custom log files,
// extra event channels / journal units and endpoint checks. Items come from the local config
// (monitoring: in agent.yaml) and from the tenant's profile, which the portal pushes through the
// gateway; each item can be limited to hosts, tags or a platform.
package monitor

import (
	"encoding/json"
	"path"
	"strings"
	"sync"
)

type LogSource struct {
	Name      string   `json:"name" mapstructure:"name"`
	Path      string   `json:"path" mapstructure:"path"`
	Include   string   `json:"include,omitempty" mapstructure:"include"`
	Exclude   string   `json:"exclude,omitempty" mapstructure:"exclude"`
	Level     string   `json:"level,omitempty" mapstructure:"level"`
	Hosts     []string `json:"hosts,omitempty" mapstructure:"hosts"`
	Tags      []string `json:"tags,omitempty" mapstructure:"tags"`
	Platform  string   `json:"platform,omitempty" mapstructure:"platform"`
	FromStart bool     `json:"fromStart,omitempty" mapstructure:"from_start"`

	// Set for logs of discovered workloads: the event source ("nginx", "SQL Server") and
	// whether "Login failed … [CLIENT: x]" lines are counted per client.
	source     string
	foldLogins bool
}

// EventSource is what events from this log are filed under: "log:<name>" for custom logs.
func (l LogSource) EventSource() string {
	if l.source != "" {
		return l.source
	}
	return "log:" + l.Name
}

type EventChannel struct {
	Channel string   `json:"channel" mapstructure:"channel"`
	IDs     []int    `json:"ids,omitempty" mapstructure:"ids"`
	Level   string   `json:"level,omitempty" mapstructure:"level"`
	Hosts   []string `json:"hosts,omitempty" mapstructure:"hosts"`
	Tags    []string `json:"tags,omitempty" mapstructure:"tags"`
}

type JournalUnit struct {
	Unit  string   `json:"unit" mapstructure:"unit"`
	Level string   `json:"level,omitempty" mapstructure:"level"`
	Hosts []string `json:"hosts,omitempty" mapstructure:"hosts"`
	Tags  []string `json:"tags,omitempty" mapstructure:"tags"`
}

type Check struct {
	Name            string   `json:"name" mapstructure:"name"`
	Type            string   `json:"type" mapstructure:"type"` // tcp | http | dns
	Target          string   `json:"target" mapstructure:"target"`
	IntervalSeconds int      `json:"intervalSeconds,omitempty" mapstructure:"interval_seconds"`
	TimeoutSeconds  int      `json:"timeoutSeconds,omitempty" mapstructure:"timeout_seconds"`
	ExpectStatus    int      `json:"expectStatus,omitempty" mapstructure:"expect_status"`
	Contains        string   `json:"contains,omitempty" mapstructure:"contains"`
	Hosts           []string `json:"hosts,omitempty" mapstructure:"hosts"`
	Tags            []string `json:"tags,omitempty" mapstructure:"tags"`
}

type Profile struct {
	Logs          []LogSource    `json:"logs,omitempty" mapstructure:"logs"`
	EventChannels []EventChannel `json:"eventChannels,omitempty" mapstructure:"event_channels"`
	JournalUnits  []JournalUnit  `json:"journalUnits,omitempty" mapstructure:"journal_units"`
	Checks        []Check        `json:"checks,omitempty" mapstructure:"checks"`
}

// Host identifies this machine for the hosts / tags / platform selectors.
type Host struct {
	Name     string
	Platform string // windows | linux | macos | docker
	Tags     []string
}

func glob(pattern, value string) bool {
	ok, err := path.Match(strings.ToLower(pattern), strings.ToLower(value))
	return err == nil && ok
}

// applies: no selector means every host; otherwise the hostname or one of the tags must match.
func (h Host) applies(hosts, tags []string) bool {
	if len(hosts) == 0 && len(tags) == 0 {
		return true
	}
	for _, p := range hosts {
		if glob(p, h.Name) {
			return true
		}
	}
	for _, p := range tags {
		for _, t := range h.Tags {
			if glob(p, t) {
				return true
			}
		}
	}
	return false
}

func (h Host) platformMatches(p string) bool {
	if p == "" {
		return true
	}
	return p == h.Platform || (p == "linux" && h.Platform == "docker")
}

// For returns the items that apply to this host.
func (p Profile) For(h Host) Profile {
	var out Profile
	for _, l := range p.Logs {
		if h.applies(l.Hosts, l.Tags) && h.platformMatches(l.Platform) {
			out.Logs = append(out.Logs, l)
		}
	}
	for _, c := range p.EventChannels {
		if h.Platform == "windows" && h.applies(c.Hosts, c.Tags) {
			out.EventChannels = append(out.EventChannels, c)
		}
	}
	for _, u := range p.JournalUnits {
		if h.Platform != "windows" && h.applies(u.Hosts, u.Tags) {
			out.JournalUnits = append(out.JournalUnits, u)
		}
	}
	for _, c := range p.Checks {
		if h.applies(c.Hosts, c.Tags) {
			out.Checks = append(out.Checks, c)
		}
	}
	return out
}

// Store merges the local profile with the one the portal pushes. On a name clash the portal wins.
type Store struct {
	mu     sync.RWMutex
	local  Profile
	remote Profile
}

func NewStore(local Profile) *Store { return &Store{local: local} }

// SetRemote replaces the portal's profile with the JSON from a gateway "config" message.
func (s *Store) SetRemote(raw json.RawMessage) error {
	var p Profile
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &p); err != nil {
			return err
		}
	}
	s.mu.Lock()
	s.remote = p
	s.mu.Unlock()
	return nil
}

func (s *Store) Effective(h Host) Profile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	merged := s.remote
	logNames, checkNames := map[string]bool{}, map[string]bool{}
	for _, l := range merged.Logs {
		logNames[strings.ToLower(l.Name)] = true
	}
	for _, c := range merged.Checks {
		checkNames[strings.ToLower(c.Name)] = true
	}
	for _, l := range s.local.Logs {
		if !logNames[strings.ToLower(l.Name)] {
			merged.Logs = append(merged.Logs, l)
		}
	}
	for _, c := range s.local.Checks {
		if !checkNames[strings.ToLower(c.Name)] {
			merged.Checks = append(merged.Checks, c)
		}
	}
	merged.EventChannels = append(append([]EventChannel{}, merged.EventChannels...), s.local.EventChannels...)
	merged.JournalUnits = append(append([]JournalUnit{}, merged.JournalUnits...), s.local.JournalUnits...)
	return merged.For(h)
}

// WorkloadLog turns a discovered workload's log into a log source.
func WorkloadLog(source, filePath, include, level string, foldLogins bool) LogSource {
	return LogSource{Name: source, Path: filePath, Include: include, Level: level, source: source, foldLogins: foldLogins}
}
