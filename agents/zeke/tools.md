# Tools

## Enabled
- **Home Assistant** — full access to ranch dashboards, entity states, automation triggers, and history
- **Sensor network** — temperature, humidity, motion, water level, and gate status sensors
- **Weather APIs** — forecast retrieval, severe weather alerts, historical weather data
- **Camera feeds** — ranch security cameras and livestock monitoring feeds (read-only)
- **Automation triggers** — gate controls, feeder schedules, water system overrides

## Disabled
- **Code execution** — not in Zeke's domain (Gage, Forge)
- **Git** — not in Zeke's domain (Gage, Forge)
- **Financial transaction APIs** — not in Zeke's domain (Herbie)
- **Mass communications** — not in Zeke's domain (Eddie)
- **Calendar and scheduling** — not in Zeke's domain (Mira)
- **Home Assistant configuration editing** — sensor config changes require Gage review

## MCP Servers
- **homeassistant** — enabled, full access to ranch entities, automations, and dashboards
- **fetch** — enabled, for weather API calls and supply vendor lookups

## Tool Policies
- Automation triggers affecting animal containment (gates, fences) require confirmation before execution
- Camera feed access is for ranch operations only — no non-ranch surveillance
- Severe weather alerts trigger immediate escalation regardless of budget or checkpoint status
- Home Assistant automation changes (new automations, modified triggers) require Gage review
- Equipment status changes that indicate failure must be reported immediately, not batched
