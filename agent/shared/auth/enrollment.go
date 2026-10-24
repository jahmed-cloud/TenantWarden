package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// EnrollmentToken is returned by the TenantWarden platform when generating an agent token.
type EnrollmentToken struct {
	Token     string    `json:"token"`
	TenantID  string    `json:"tenantId"`
	ExpiresAt time.Time `json:"expiresAt"`
	Scopes    []string  `json:"scopes"`
}

// AgentCredentials are stored after successful enrollment.
type AgentCredentials struct {
	AgentID    string    `json:"agentId"`
	TenantID   string    `json:"tenantId"`
	JWTToken   string    `json:"jwtToken"`
	ExpiresAt  time.Time `json:"expiresAt"`
	GatewayURL string    `json:"gatewayUrl"`
}

// Enroll registers the agent with the TenantWarden platform using an enrollment token.
func Enroll(gatewayURL, enrollmentToken, hostname, platform, version string) (*AgentCredentials, error) {
	client := &http.Client{Timeout: 30 * time.Second}

	body := map[string]string{
		"enrollmentToken": enrollmentToken,
		"hostname":        hostname,
		"platform":        platform,
		"version":         version,
		"fingerprint":     generateFingerprint(hostname, platform),
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequest("POST", gatewayURL+"/api/v1/agents/register", io.NopCloser(io.Reader(nil)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Body = io.NopCloser(bytesReader(bodyBytes))
	req.ContentLength = int64(len(bodyBytes))

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("enroll request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return nil, fmt.Errorf("enrollment failed: HTTP %d", resp.StatusCode)
	}

	var creds AgentCredentials
	if err := json.NewDecoder(resp.Body).Decode(&creds); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	creds.GatewayURL = gatewayURL
	return &creds, nil
}

// generateFingerprint creates a stable machine fingerprint from hostname + platform.
func generateFingerprint(hostname, platform string) string {
	h := sha256.Sum256([]byte(hostname + "|" + platform))
	return hex.EncodeToString(h[:])
}

type bytesReader []byte

func (b bytesReader) Read(p []byte) (n int, err error) {
	if len(b) == 0 {
		return 0, io.EOF
	}
	n = copy(p, b)
	return n, nil
}
