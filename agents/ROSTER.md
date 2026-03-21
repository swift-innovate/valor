# VALOR Operative Roster

**Last Updated:** 2026-03-21  
**Purpose:** Capability manifest for VALOR Director routing and mission assignment

This document defines each operative's capabilities, domain expertise, tool access, and escalation thresholds. The Director uses this manifest to route missions to the appropriate operative based on domain keywords and capability requirements.

---

## Mira

```yaml
operative: Mira
callsign: MIRA
division: Command
role: Chief of Staff / Executive Assistant
capabilities:
  - Scheduling and calendar management
  - Cross-division coordination
  - Research and information synthesis
  - Meeting summarization and note-taking
  - Task tracking and follow-up
  - Document drafting and editing
  - General Q&A and information lookup
  - Email composition and routing
  - Travel planning and logistics
  - Vendor research and comparison
domain_keywords:
  - schedule
  - calendar
  - meeting
  - research
  - summary
  - notes
  - coordination
  - followup
  - email
  - draft
  - organize
  - logistics
  - travel
  - vendor
  - comparison
preferred_model_tier: balanced
tool_access:
  - Web search
  - Calendar (Google)
  - Email (Gmail)
  - Document creation
  - File management
  - Messaging (Telegram, Slack)
escalation_rules: >
  Escalate to Director when: (1) decision requires Principal approval (budget >$500, external commitments, policy changes), (2) conflicting priorities from multiple division leads, (3) sensitive personnel or legal matters, (4) requests involving confidential business information.
limitations: >
  Does NOT handle: Code implementation, infrastructure deployment, financial transactions, public content publishing (blogs, social media), legal document signing, contractual commitments.
```

---

## Crazy-Eddie

```yaml
operative: Crazy-Eddie
callsign: EDDIE
division: SIT (Swift Innovate Technologies)
role: SIT Division Lead — Business Operations, Marketing, Content Strategy
capabilities:
  - Email marketing campaign design and execution
  - Content strategy and editorial planning
  - Marketing analytics and reporting
  - LinkedIn thought leadership content
  - KDP (Kindle Direct Publishing) workflow
  - MailerLite campaign management
  - Audience segmentation and targeting
  - A/B testing and optimization
  - Competitor analysis
  - Business development research
  - Product positioning and messaging
  - Sales funnel design
domain_keywords:
  - marketing
  - email
  - campaign
  - content
  - LinkedIn
  - thought leadership
  - KDP
  - publishing
  - MailerLite
  - newsletter
  - audience
  - segmentation
  - analytics
  - conversion
  - funnel
  - sales
  - business development
  - competitor
  - positioning
  - messaging
  - brand
preferred_model_tier: balanced
tool_access:
  - MailerLite API
  - LinkedIn (read-only monitoring)
  - Web search and research
  - Analytics platforms
  - Document creation
  - Email (Gmail)
escalation_rules: >
  Escalate to Director/Principal when: (1) mass email sends >500 recipients (requires approval), (2) public content publishing (LinkedIn posts, blog articles), (3) budget allocation for paid campaigns, (4) vendor contracts or commitments, (5) brand positioning or messaging changes.
limitations: >
  Does NOT handle: Final approval for public-facing content, paid advertising spend, legal/contractual commitments, product development decisions, code or infrastructure work.
```

---

## Forge

```yaml
operative: Forge
callsign: FORGE
division: Code
role: Software Development — Implementation, Debugging, Code Review
capabilities:
  - Software development (Python, TypeScript, JavaScript, Rust)
  - Infrastructure as Code (Terraform, Ansible)
  - Code review and debugging
  - Test suite creation and maintenance
  - Script automation
  - API integration
  - Database schema design
  - Git workflow management
  - Documentation (technical)
  - Performance profiling and optimization
  - Security vulnerability patching
  - Dependency management
domain_keywords:
  - code
  - development
  - programming
  - Python
  - TypeScript
  - JavaScript
  - Rust
  - Terraform
  - Ansible
  - debugging
  - bug
  - test
  - API
  - integration
  - database
  - schema
  - script
  - automation
  - git
  - security
  - performance
  - optimization
preferred_model_tier: balanced
tool_access:
  - Git (read/write)
  - Code execution environment
  - Package managers (npm, pip, cargo)
  - Database access (dev/staging only)
  - CI/CD pipelines
  - Testing frameworks
escalation_rules: >
  Escalate to Gage when: (1) architectural decisions affecting multiple systems, (2) production database changes, (3) security-critical code (auth, crypto, access control), (4) breaking API changes. Escalate to Director when: (5) deployment to production, (6) infrastructure changes affecting live systems.
limitations: >
  Does NOT handle: Production deployments without approval, architectural decisions (defer to Gage), security-critical implementations without review, changes to auth/authorization systems, infrastructure changes outside sandbox/dev environments.
```

---

## Gage

```yaml
operative: Gage
callsign: GAGE
division: Code
role: Code Division Lead — Senior Architecture, Complex Implementations
capabilities:
  - System architecture and design
  - Complex algorithm implementation
  - Strategic technical decision-making
  - Cross-system integration architecture
  - Performance and scalability design
  - Security architecture review
  - Code Division leadership and mentorship
  - Technical debt assessment and prioritization
  - Technology selection and evaluation
  - Disaster recovery and resilience design
  - API contract design
  - All Forge capabilities (advanced level)
domain_keywords:
  - architecture
  - design
  - system design
  - integration
  - scalability
  - performance
  - security architecture
  - technical strategy
  - complex implementation
  - algorithm
  - optimization
  - technical debt
  - technology evaluation
  - API design
  - resilience
  - disaster recovery
preferred_model_tier: frontier
tool_access:
  - Full Code Division tooling
  - Claude Code (primary interface)
  - Production infrastructure (read-only)
  - All development environments
  - Architecture documentation
escalation_rules: >
  Escalate to Director/Principal when: (1) architectural decisions with business impact >$10K, (2) technology migrations affecting multiple systems, (3) security incidents, (4) production outages, (5) changes to core business logic.
limitations: >
  Does NOT handle: Business strategy decisions, vendor contracts, financial commitments, public-facing content, marketing or sales activities.
```

---

## Zeke

```yaml
operative: Zeke
callsign: ZEKE
division: Ranch (Swift Ranch Operations)
role: Ranch Management, Livestock, Homesteading, Agricultural Tech
capabilities:
  - Livestock health monitoring and tracking
  - Equipment maintenance scheduling
  - Land management planning
  - Agricultural technology integration
  - Sensor data analysis (Home Assistant)
  - Weather monitoring and alerts
  - Feed and supply inventory management
  - Pasture rotation planning
  - Infrastructure status reporting
  - Ranch automation (gates, feeders, water)
  - Emergency alert monitoring
domain_keywords:
  - ranch
  - livestock
  - cattle
  - pasture
  - feed
  - equipment
  - sensor
  - Home Assistant
  - weather
  - land
  - agriculture
  - homesteading
  - barn
  - fence
  - water
  - automation
  - alert
  - emergency
preferred_model_tier: local
tool_access:
  - Home Assistant (full access)
  - Sensor network (temperature, humidity, motion)
  - Weather APIs
  - Camera feeds (ranch security/monitoring)
  - Automation triggers (gates, feeders)
escalation_rules: >
  Escalate to Principal immediately when: (1) livestock health emergencies, (2) equipment failure affecting animal welfare, (3) security breaches (gates, fences), (4) severe weather threats, (5) infrastructure damage. Escalate to Director for: (6) capital equipment purchases, (7) vendor selection for supplies, (8) long-term land management decisions.
limitations: >
  Does NOT handle: Veterinary medical decisions (consult Principal), large equipment purchases without approval, personnel decisions, legal/regulatory compliance, hazardous material handling.
```

---

## Rook

```yaml
operative: Rook
callsign: ROOK
division: R&D (Research & Development / Red Team)
role: Security Analysis, Experimental Features, Adversarial Review
capabilities:
  - Security vulnerability assessment
  - Penetration testing and ethical hacking
  - Threat modeling and risk analysis
  - Experimental feature prototyping
  - Novel approach research
  - Adversarial testing (red team)
  - Security architecture review
  - Cryptographic implementation review
  - Compliance gap analysis
  - Zero-day research and mitigation
  - Attack surface analysis
  - Security tool evaluation
domain_keywords:
  - security
  - vulnerability
  - penetration testing
  - red team
  - threat
  - risk
  - experimental
  - prototype
  - research
  - adversarial
  - attack
  - exploit
  - cryptography
  - compliance
  - zero-day
  - audit
  - hardening
preferred_model_tier: frontier
tool_access:
  - Isolated testing environment
  - Security scanning tools
  - Network monitoring
  - Code analysis tools
  - Sandboxed execution environment
  - Research databases and CVE feeds
escalation_rules: >
  Escalate to Director/Principal immediately when: (1) active security incident detected, (2) critical vulnerability found in production systems, (3) compliance violation identified, (4) data breach suspected. Escalate to Gage for: (5) security architecture recommendations, (6) cryptographic implementation review. Standard escalation for: (7) experimental features ready for production consideration.
limitations: >
  Does NOT handle: Production deployments, live system changes without approval, disclosure of vulnerabilities to external parties (Principal only), legal/compliance decisions, business risk assessment (security risk only).
```

---

## Herbie

```yaml
operative: Herbie
callsign: HERBIE
division: Finance
role: Financial Operations — Paper Trading, Portfolio Tracking, Market Analysis
capabilities:
  - BTC/ETH paper trading simulation
  - Portfolio performance tracking
  - Market analysis and trend identification
  - Financial modeling and projections
  - Risk/reward scenario analysis
  - Trade strategy backtesting
  - Market data aggregation
  - Price alert monitoring
  - Investment research and due diligence
  - Tax implication modeling (simulated)
domain_keywords:
  - finance
  - trading
  - portfolio
  - BTC
  - ETH
  - crypto
  - market
  - analysis
  - investment
  - risk
  - reward
  - strategy
  - price
  - alert
  - research
  - tax
preferred_model_tier: balanced
tool_access:
  - Market data APIs (read-only)
  - Paper trading simulation environment
  - Portfolio tracking tools (read-only)
  - Financial modeling spreadsheets
  - Research databases
escalation_rules: >
  **CRITICAL**: MUST escalate to Principal for ANY real financial transaction. Herbie operates ONLY in paper trading / simulation mode. Escalate to Principal when: (1) any request involving real money movement, (2) account access requests, (3) withdrawal/deposit requests, (4) exchange authentication, (5) wallet operations, (6) recommendations for real trades.
limitations: >
  **ABSOLUTE LIMITATIONS**: NEVER handles real financial transactions. NEVER accesses real trading accounts. NEVER executes real trades. NEVER moves real money. Paper trading and analysis ONLY. Any request involving real money MUST be escalated to Principal immediately. Does NOT provide investment advice (analysis only). Does NOT make financial decisions.
```

---

## Paladin

```yaml
operative: Paladin
callsign: PALADIN
division: Autonomous Operations
role: Long-Running Tasks, Monitoring, Background Processes
capabilities:
  - Long-running task execution and monitoring
  - Scheduled job management
  - System health monitoring
  - Autonomous workflow execution
  - Telegram-based autonomous operations
  - Background process supervision
  - Heartbeat monitoring and alerting
  - Periodic status reporting
  - Unattended task orchestration
  - Retry and recovery automation
  - Log aggregation and analysis
domain_keywords:
  - monitoring
  - background
  - scheduled
  - autonomous
  - long-running
  - heartbeat
  - alert
  - periodic
  - unattended
  - automation
  - task
  - process
  - supervision
  - status
  - health
  - cron
  - daemon
preferred_model_tier: local
tool_access:
  - Task scheduling system (cron, systemd)
  - Monitoring dashboards
  - Log aggregation tools
  - Messaging (Telegram for status updates)
  - Process management (systemd, supervisor)
  - Health check endpoints
escalation_rules: >
  Escalate to Director when: (1) critical system failures detected, (2) multiple consecutive task failures, (3) resource exhaustion (disk, memory, CPU), (4) security alerts, (5) tasks blocked >24 hours. Escalate to relevant division lead for domain-specific task failures.
limitations: >
  Does NOT handle: Interactive user support, complex decision-making, code implementation, business strategy, financial transactions, public-facing communications. Operates within predefined automation parameters only.
```

---

## Routing Guidelines for Director

When assigning missions, the Director should consider:

1. **Primary operative** based on domain keywords and core capabilities
2. **Escalation chain** for complex missions requiring multiple operatives
3. **Model tier requirements** — match mission complexity to operative's preferred tier
4. **Safety gates** — hard-code escalation rules for financial transactions, mass communications, production deployments
5. **Division context** — leverage division leads (Eddie, Gage) for strategic decisions within their domain

### Example Routing Patterns

| Mission Type | Primary | Backup | Escalation |
|--------------|---------|--------|------------|
| Code review | Forge | Gage | Gage (complex) |
| Email campaign | Eddie | Mira | Principal (mass send) |
| Security audit | Rook | Gage | Principal (critical vuln) |
| Ranch sensor alert | Zeke | Paladin | Principal (emergency) |
| Market analysis | Herbie | — | Principal (real trades) |
| Meeting summary | Mira | — | Director (conflicts) |
| Long-running automation | Paladin | — | Relevant division lead |

### Safety-Critical Escalation Patterns (Hard-Coded)

These patterns MUST be enforced in Director logic, not left to LLM judgment:

1. **Real financial transactions** → Always escalate to Principal (never assign to Herbie)
2. **Mass communications** (>500 recipients) → Always require Principal approval
3. **Production deployments** → Always escalate to Division Lead → Principal
4. **Public content publishing** → Always escalate to Principal
5. **Legal/contractual commitments** → Always escalate to Principal
6. **Livestock/human safety emergencies** → Always escalate to Principal immediately

---

**Document Status:** COMPLETE  
**Mission:** VM-004  
**Operative:** Mira  
**Date:** 2026-03-21
