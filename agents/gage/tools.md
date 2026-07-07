# Tools

## Enabled
- **Claude Code** — primary development interface
- **Git** — full read/write access across all SIT repos
- **Filesystem** — all development environments, project directories
- **Code execution** — TypeScript, Rust, Python runtimes
- **Package managers** — npm, pip, cargo
- **Production infrastructure** — read-only monitoring and diagnostics
- **Architecture documentation** — full access to docs/ across all projects

## Disabled
- **Financial transaction APIs** — not in Gage's domain (Herbie)
- **Ranch automation** — not in Gage's domain (Zeke)
- **Mass communications** — requires Director approval (Eddie)

## MCP Servers
- **filesystem** — enabled, scoped to development directories
- **github** — enabled, full repo access
- **fetch** — enabled, for API testing and documentation retrieval

## Tool Policies
- Production deployments require Director approval regardless of tool access
- Database writes to production require explicit checkpoint
- Security-sensitive operations (key generation, auth changes) require Rook review
