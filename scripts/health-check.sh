#!/usr/bin/env bash
# TenantWarden — health check all services
# Usage: ./scripts/health-check.sh
set -euo pipefail

OK=0
FAIL=0
WARN=0

check() {
  local name="$1"
  local url="$2"
  local expected="${3:-200}"

  code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")

  if [[ "$code" == "$expected" ]]; then
    echo "  ✅ $name ($url) — HTTP $code"
    ((OK++))
  elif [[ "$code" == "000" ]]; then
    echo "  ❌ $name ($url) — UNREACHABLE"
    ((FAIL++))
  else
    echo "  ⚠️  $name ($url) — HTTP $code (expected $expected)"
    ((WARN++))
  fi
}

echo ""
echo "TenantWarden — Service Health Check"
echo "════════════════════════════════════"
echo ""

echo "Core services:"
check "Gateway (HTTP)"         "http://localhost:8090/api/health"
check "API health"             "http://localhost:8080/health"
check "Auth service"           "http://localhost:8081/health"
check "Agent gateway"          "http://localhost:8082/health"

echo ""
echo "Node services:"
check "Collector service"      "http://localhost:3001/health"
check "Alert engine"           "http://localhost:3002/health"
check "Analytics engine"       "http://localhost:3004/health"
check "Notification service"   "http://localhost:3003/health"
check "Plugin engine"          "http://localhost:3005/health"
check "Scheduler"              "http://localhost:3006/health"

echo ""
echo "Data layer:"
check "PostgreSQL (direct)"    "http://localhost:5432" "000"  # won't respond to HTTP
check "Redis (direct)"         "http://localhost:6379" "000"
check "ClickHouse HTTP"        "http://localhost:8123/ping"
check "MinIO console"          "http://localhost:9001"

echo ""
echo "Observability:"
check "Prometheus"             "http://localhost:9090/-/ready"
check "Grafana"                "http://localhost:3001/api/health"
check "Loki ready"             "http://localhost:3100/ready"

echo ""
echo "═══════════════════"
echo "  ✅ OK:    $OK"
echo "  ⚠️  WARN:  $WARN"
echo "  ❌ FAIL:  $FAIL"
echo "═══════════════════"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "Some services are down. Run 'docker compose ps' to investigate."
  exit 1
fi
