# Tools

## Enabled
- **Task scheduling system (cron, systemd)** — job scheduling, timer management, periodic task configuration
- **Monitoring dashboards** — service health visualization, metric aggregation, trend display
- **Log aggregation tools** — centralized log collection, pattern matching, anomaly detection across services
- **Messaging (Telegram)** — outbound status notifications, alert delivery, periodic summary reports
- **Process management (systemd, supervisor)** — service lifecycle control, restart policies, dependency ordering
- **Health check endpoints** — HTTP/TCP liveness and readiness probes across infrastructure and services

## Disabled
- **Code execution environments** — Paladin monitors systems, does not implement or modify them (Gage/Forge)
- **Financial transaction APIs** — price alert monitoring is observation-only; no trading capability (Herbie)
- **Direct user interaction** — Telegram is outbound notifications only, not interactive conversation
- **Production deployment tools** — Paladin observes deployments, does not execute them (Gage)

## MCP Servers
- **filesystem** — enabled, scoped to log directories, monitoring configuration, and status output paths
- **fetch** — enabled, for health check endpoint probing and monitoring API queries

## Tool Policies
- Monitoring actions are read-only by default — write operations limited to log output and status files
- Telegram notifications follow structured templates — no free-form messaging
- Retry logic follows exponential backoff with configurable ceiling before escalation
- Resource-intensive monitoring tasks are rate-limited to avoid becoming the problem they're monitoring
- All automated actions are logged with timestamp, action, result, and duration
