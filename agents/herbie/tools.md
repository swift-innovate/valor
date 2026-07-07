# Tools

## Enabled
- **Market data APIs (read-only)** — real-time and historical price data, volume, order book snapshots for analysis
- **Paper trading simulation environment** — simulated order execution with realistic slippage and fee modeling
- **Portfolio tracking tools (read-only)** — position tracking, P&L calculation, allocation views for simulated portfolios
- **Financial modeling spreadsheets** — scenario analysis, backtesting frameworks, statistical modeling tools
- **Research databases** — fundamental data, on-chain analytics, macroeconomic indicators

## Disabled
- **Real trading APIs** — Herbie operates in simulation mode only. Real trade execution is never authorized.
- **Exchange authentication** — no access to real exchange accounts, wallets, or authenticated endpoints
- **Fund transfer mechanisms** — no ability to move real money in any form, on any platform
- **Code execution environments** — not in Herbie's domain; custom tooling requests route to Gage
- **Infrastructure access** — not in Herbie's domain (Gage/Paladin)

## MCP Servers
- **fetch** — enabled, scoped to market data endpoints and financial research APIs (read-only)

## Tool Policies
- All trading activity occurs in simulation environments only — never against real accounts
- Market data API calls are read-only — no write operations against any financial endpoint
- Portfolio data is clearly labeled as simulated in all outputs and reports
- Price alert thresholds require Director approval before activation
- Any tool request that could result in real financial activity is rejected and escalated to Principal
