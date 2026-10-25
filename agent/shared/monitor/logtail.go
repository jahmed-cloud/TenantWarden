package monitor

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/tenantwarden/agent/shared/collectors"
)

const (
	maxFilesPerSource  = 20
	maxReadPerFile     = 1 << 20  // per collection; the rest is read next time
	maxBacklog         = 50 << 20 // further behind than this, skip to the end
	maxEventsPerSource = 200
)

var sqlLoginFailed = regexp.MustCompile(`Login failed for user '([^']*)'.*\[CLIENT: ([^\]]+)\]`)

type fileState struct {
	Offset  int64  `json:"offset"`
	Head    string `json:"head"`     // hash of the first HeadLen bytes: a different file at the same path starts over
	HeadLen int    `json:"head_len"` // under 256 while the file is still short
}

func hashOf(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:8])
}

// Tailer follows log files and turns new lines into events. Offsets survive restarts.
type Tailer struct {
	mu       sync.Mutex
	file     string
	state    map[string]*fileState
	patterns map[string]*regexp.Regexp
	warned   map[string]bool
}

func NewTailer(stateFile string) *Tailer {
	t := &Tailer{file: stateFile, state: map[string]*fileState{}, patterns: map[string]*regexp.Regexp{}, warned: map[string]bool{}}
	if data, err := os.ReadFile(stateFile); err == nil {
		_ = json.Unmarshal(data, &t.state)
	}
	return t
}

// Collect reads what was appended to every source's files since the last call.
func (t *Tailer) Collect(sources []LogSource) []collectors.Event {
	t.mu.Lock()
	defer t.mu.Unlock()
	var events []collectors.Event
	now := time.Now().UTC()
	seen := map[string]bool{}

	for _, src := range sources {
		include, errInc := t.pattern(src.Include)
		exclude, errExc := t.pattern(src.Exclude)
		if errInc != nil || errExc != nil {
			events = append(events, t.warnOnce(src, fmt.Sprintf("log source %q: invalid pattern: %v", src.Name, firstErr(errInc, errExc)), now)...)
			continue
		}
		files, err := filepath.Glob(src.Path)
		if err != nil || len(files) == 0 {
			if src.source == "" { // built-in workload logs often have several candidate paths
				events = append(events, t.warnOnce(src, fmt.Sprintf("log source %q: no file matches %s", src.Name, src.Path), now)...)
			}
			continue
		}
		files = realFiles(files)
		if len(files) > maxFilesPerSource {
			files = files[len(files)-maxFilesPerSource:]
		}

		emitted, skipped := 0, 0
		failures := map[string]int{}
		for _, f := range files {
			key := src.EventSource() + "|" + f
			seen[key] = true
			for _, line := range t.readNew(key, f, src.FromStart) {
				if include != nil && !include.MatchString(line) {
					continue
				}
				if exclude != nil && exclude.MatchString(line) {
					continue
				}
				if src.foldLogins {
					if m := sqlLoginFailed.FindStringSubmatch(line); m != nil {
						failures[m[2]]++
						continue
					}
				}
				if emitted >= maxEventsPerSource {
					skipped++
					continue
				}
				level := src.Level
				if level == "" || level == "auto" {
					level = collectors.DetectLevel(line)
				}
				events = append(events, collectors.Event{Level: level, Source: src.EventSource(), Message: oneLine(line, 1000), OccurredAt: now})
				emitted++
			}
		}
		if skipped > 0 {
			events = append(events, collectors.Event{Level: "warning", Source: src.EventSource(),
				Message: fmt.Sprintf("%d more matching lines since the last collection were not sent", skipped), OccurredAt: now})
		}
		events = append(events, collectors.FoldFailures(src.EventSource(), failures, now)...)
	}

	// Forget files that are no longer configured
	for key := range t.state {
		if !seen[key] {
			delete(t.state, key)
		}
	}
	t.save()
	return events
}

// realFiles drops logs that are really streams: container images link /var/log/nginx/error.log
// to /dev/stderr, which for this process is the agent's own output.
func realFiles(paths []string) []string {
	var out []string
	for _, p := range paths {
		resolved, err := filepath.EvalSymlinks(p)
		if err != nil || strings.HasPrefix(resolved, "/dev/") || strings.HasPrefix(resolved, "/proc/") {
			continue
		}
		if info, err := os.Stat(resolved); err == nil && info.Mode().IsRegular() {
			out = append(out, p)
		}
	}
	return out
}

func (t *Tailer) warnOnce(src LogSource, msg string, at time.Time) []collectors.Event {
	if t.warned[msg] {
		return nil
	}
	t.warned[msg] = true
	return []collectors.Event{{Level: "warning", Source: src.EventSource(), Message: msg, OccurredAt: at}}
}

func (t *Tailer) pattern(expr string) (*regexp.Regexp, error) {
	if expr == "" {
		return nil, nil
	}
	if re, ok := t.patterns[expr]; ok {
		return re, nil
	}
	re, err := regexp.Compile("(?i)" + expr)
	if err != nil {
		return nil, err
	}
	t.patterns[expr] = re
	return re, nil
}

// readNew returns the complete lines appended since the stored offset. A new file starts at
// its end (unless fromStart), so a fresh agent doesn't replay months of history.
func (t *Tailer) readNew(key, path string, fromStart bool) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return nil
	}
	size := info.Size()

	headBuf := make([]byte, 256)
	n, _ := io.ReadFull(f, headBuf)
	headBuf = headBuf[:n]
	utf16le := len(headBuf) >= 2 && headBuf[0] == 0xFF && headBuf[1] == 0xFE

	st, known := t.state[key]
	if !known {
		st = &fileState{Head: hashOf(headBuf), HeadLen: n, Offset: size}
		if fromStart {
			st.Offset = 0
		}
		t.state[key] = st
		if !fromStart {
			return nil
		}
	} else if n < st.HeadLen || hashOf(headBuf[:st.HeadLen]) != st.Head || size < st.Offset {
		st.Offset = 0 // rotated or truncated: a new file at the same path
	}
	st.Head, st.HeadLen = hashOf(headBuf), n
	if size-st.Offset > maxBacklog {
		st.Offset = size
		return nil
	}
	if size <= st.Offset {
		return nil
	}

	toRead := min(size-st.Offset, maxReadPerFile)
	buf := make([]byte, toRead)
	if _, err := f.ReadAt(buf, st.Offset); err != nil && err != io.EOF {
		return nil
	}
	var text string
	consumed := int64(0)
	if utf16le {
		// SQL Server's ERRORLOG is UTF-16: decode whole code units up to the last newline
		if st.Offset == 0 && len(buf) >= 2 {
			buf, consumed = buf[2:], 2
		}
		units := make([]uint16, len(buf)/2)
		for i := range units {
			units[i] = binary.LittleEndian.Uint16(buf[i*2:])
		}
		last := -1
		for i, u := range units {
			if u == '\n' {
				last = i
			}
		}
		if last < 0 {
			return nil
		}
		text = string(utf16.Decode(units[:last+1]))
		consumed += int64(last+1) * 2
	} else {
		last := bytes.LastIndexByte(buf, '\n')
		if last < 0 {
			return nil // wait for the line to be completed
		}
		text = string(buf[:last+1])
		consumed = int64(last + 1)
	}
	st.Offset += consumed

	var out []string
	for _, line := range strings.Split(text, "\n") {
		if line = strings.TrimSpace(strings.TrimSuffix(line, "\r")); line != "" {
			out = append(out, line)
		}
	}
	return out
}

func (t *Tailer) save() {
	data, err := json.Marshal(t.state)
	if err == nil {
		_ = os.WriteFile(t.file, data, 0600)
	}
}

func oneLine(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func firstErr(errs ...error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}
