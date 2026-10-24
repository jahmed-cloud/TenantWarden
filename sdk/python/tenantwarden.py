"""
TenantWarden Python SDK
Use this to integrate TenantWarden into your own applications,
send custom events, or build plugins.

Installation:
    pip install requests

Usage:
    from tenantwarden import TenantWardenClient

    client = TenantWardenClient(
        base_url="https://your-domain.com",
        api_key="grd_your_api_key",
        tenant_id="your-tenant-uuid",
    )

    client.ingest_events([{
        "source":     "my-app",
        "event_type": "login_failure",
        "message":    "User authentication failed",
        "severity":   "medium",
        "data":       {"user": "john@example.com", "ip": "1.2.3.4"},
    }])
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Optional
import requests


@dataclass
class TenantWardenConfig:
    base_url:  str
    tenant_id: str
    api_key:   Optional[str] = None
    token:     Optional[str] = None
    timeout:   int = 30


class TenantWardenClient:
    def __init__(self, base_url: str, tenant_id: str, api_key: str | None = None,
                 token: str | None = None, timeout: int = 30):
        self.base_url  = base_url.rstrip("/")
        self.tenant_id = tenant_id
        self.timeout   = timeout
        self.session   = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})

        if api_key:
            self.session.headers["X-API-Key"] = api_key
        elif token:
            self.session.headers["Authorization"] = f"Bearer {token}"

    # ── Events ────────────────────────────────────────────────────────────────

    def ingest_events(self, events: list[dict[str, Any]]) -> dict:
        """Ingest custom events into TenantWarden."""
        resp = self.session.post(
            f"{self.base_url}/api/v1/events",
            json=events,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def ingest_event(self, source: str, event_type: str, message: str,
                     severity: str = "info", data: dict | None = None) -> dict:
        """Ingest a single event."""
        return self.ingest_events([{
            "source":    source,
            "eventType": event_type,
            "message":   message,
            "severity":  severity,
            "data":      data or {},
        }])

    # ── Alerts ────────────────────────────────────────────────────────────────

    def get_alerts(self, severity: str | None = None, status: str | None = None,
                   search: str | None = None, page: int = 1, page_size: int = 50) -> dict:
        """Retrieve alerts with optional filtering."""
        params = {"tenantId": self.tenant_id, "page": page, "pageSize": page_size}
        if severity: params["severity"] = severity
        if status:   params["status"]   = status
        if search:   params["search"]   = search

        resp = self.session.get(f"{self.base_url}/api/v1/alerts", params=params, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def acknowledge_alert(self, alert_id: str, comment: str | None = None) -> None:
        resp = self.session.post(
            f"{self.base_url}/api/v1/alerts/{alert_id}/acknowledge",
            json={"comment": comment},
            timeout=self.timeout,
        )
        resp.raise_for_status()

    def resolve_alert(self, alert_id: str, resolution: str) -> None:
        resp = self.session.post(
            f"{self.base_url}/api/v1/alerts/{alert_id}/resolve",
            json={"resolution": resolution},
            timeout=self.timeout,
        )
        resp.raise_for_status()

    # ── Overview ──────────────────────────────────────────────────────────────

    def get_summary(self) -> dict:
        resp = self.session.get(
            f"{self.base_url}/api/v1/overview/summary",
            params={"tenantId": self.tenant_id},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()
