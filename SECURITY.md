# Security Policy

TenantWarden handles Microsoft 365 credentials and security telemetry. Please
report vulnerabilities privately to the maintainer, Junaid Ahmed
([@jahmed-cloud](https://github.com/jahmed-cloud)), using GitHub's private vulnerability
reporting on this repository rather than a public issue. Do not include real
tenant secrets in reports.

Hardening checklist for deployments: rotate `.env` secrets, use certificate
auth instead of client secrets where possible, terminate TLS at the gateway
(port 8443), restrict Postgres/Redis to the internal Docker network, and keep
`ENCRYPTION_KEY` backed up — tenant secrets are AES-256-GCM encrypted with it.
