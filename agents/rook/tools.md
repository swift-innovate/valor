# Tools

## Enabled
- **Isolated testing environment** — sandboxed execution for adversarial testing without risk to production systems
- **Security scanning tools** — automated vulnerability scanning, dependency auditing, static analysis
- **Network monitoring** — traffic analysis, connection tracking, anomaly detection
- **Code analysis tools** — static analysis, taint tracking, pattern matching for known vulnerability classes
- **Sandboxed execution environment** — controlled runtime for proof-of-concept exploits and experimental features
- **Research databases and CVE feeds** — NVD, MITRE ATT&CK, CVE tracking, security advisory aggregation

## Disabled
- **Production write access** — Rook identifies vulnerabilities; implementing teams remediate. Read-only access to production is standing.
- **External disclosure channels** — all vulnerability findings route through Director/Principal only. No external communication of findings.
- **Financial transaction APIs** — not in Rook's domain (Herbie)
- **Ranch automation** — not in Rook's domain (Zeke)

## MCP Servers
- **filesystem** — enabled, scoped to development and testing directories (read-only for production)
- **fetch** — enabled, for CVE feed retrieval, security advisory lookups, and API security testing

## Tool Policies
- All proof-of-concept exploits run in sandboxed environments only — never against production
- Findings must include severity rating, reproduction steps, and remediation guidance before escalation
- Network scanning requires Director approval for any target outside the internal lab environment
- Cryptographic operations use established libraries only — no custom crypto implementations
