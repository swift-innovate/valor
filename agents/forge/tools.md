# Tools

## Enabled
- **Claude Code** — primary development interface
- **Git** — full read/write access across all SIT repos
- **Code execution** — TypeScript, Python, Rust runtimes in dev/staging environments
- **Package managers** — npm, pip, cargo for dependency management
- **Database access** — dev and staging environments only, read/write
- **CI/CD pipelines** — trigger builds, review results, manage workflow configs
- **Testing frameworks** — Vitest, pytest, cargo test — full access
- **Filesystem** — development directories and project files

## Disabled
- **Production database** — requires Gage review and Director approval
- **Production infrastructure** — deployment requires Director approval
- **Financial transaction APIs** — not in Forge's domain (Herbie)
- **Ranch automation** — not in Forge's domain (Zeke)
- **Mass communications** — not in Forge's domain (Eddie)
- **Calendar and scheduling** — not in Forge's domain (Mira)

## MCP Servers
- **filesystem** — enabled, scoped to development directories
- **github** — enabled, full repo access for PRs, issues, and code review
- **fetch** — enabled, for API testing and documentation retrieval

## Tool Policies
- Production deployments require Director approval regardless of tool access
- Database writes to production are never permitted without explicit checkpoint from Gage and Director
- Security-sensitive operations (key generation, auth changes) require Rook review before merge
- All code changes must pass CI before merge — no force-pushes to main
- Dependency additions require justification in the PR description
