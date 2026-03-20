#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# VALOR Engine — Eddie + Mira Integration Test
# ─────────────────────────────────────────────────────────
# Prerequisites: VALOR engine running on localhost:3200
#   cd <valor-engine-root> && pnpm dev
#
# Usage: bash tests/integration/test-eddie-mira-comms.sh
# ─────────────────────────────────────────────────────────

BASE="http://localhost:3200"
PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✅ $desc"
    ((PASS++))
  else
    echo "  ❌ $desc (expected=$expected, got=$actual)"
    ((FAIL++))
  fi
}

echo ""
echo "═══════════════════════════════════════════════════"
echo "  VALOR Integration Test: Eddie + Mira Comms"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Step 1: Health check ─────────────────────────────────
echo "▸ Step 1: Engine health check"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
check "Engine is running" "200" "$STATUS"
echo ""

# ── Step 2: Submit Eddie's agent card ────────────────────
echo "▸ Step 2: Submit Eddie's agent card"
EDDIE_CARD=$(curl -s -X POST "$BASE/agent-cards" \
  -H "Content-Type: application/json" \
  -d '{
    "callsign": "Eddie",
    "name": "Crazy Eddie — SIT Division Lead",
    "operator": "SIT",
    "primary_skills": ["business_ops", "accounting", "brand", "consulting"],
    "runtime": "claude_api",
    "model": "claude-sonnet-4-20250514",
    "description": "SIT Division Lead — business ops, accounting, brand strategy, consulting"
  }')
EDDIE_CARD_ID=$(echo "$EDDIE_CARD" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
EDDIE_CARD_STATUS=$(echo "$EDDIE_CARD" | python3 -c "import sys,json; print(json.load(sys.stdin)['approval_status'])" 2>/dev/null)
check "Eddie card submitted" "pending" "$EDDIE_CARD_STATUS"
echo "  → Card ID: $EDDIE_CARD_ID"
echo ""

# ── Step 3: Submit Mira's agent card ─────────────────────
echo "▸ Step 3: Submit Mira's agent card"
MIRA_CARD=$(curl -s -X POST "$BASE/agent-cards" \
  -H "Content-Type: application/json" \
  -d '{
    "callsign": "Mira",
    "name": "Mira — Chief of Staff",
    "operator": "SIT",
    "primary_skills": ["executive_assistant", "triage", "cross_division", "strategy"],
    "runtime": "claude_api",
    "model": "claude-sonnet-4-20250514",
    "description": "Chief of Staff — cross-cutting, Director proxy, triage and coordination"
  }')
MIRA_CARD_ID=$(echo "$MIRA_CARD" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
MIRA_CARD_STATUS=$(echo "$MIRA_CARD" | python3 -c "import sys,json; print(json.load(sys.stdin)['approval_status'])" 2>/dev/null)
check "Mira card submitted" "pending" "$MIRA_CARD_STATUS"
echo "  → Card ID: $MIRA_CARD_ID"
echo ""

# ── Step 4: Verify pending cards show up ─────────────────
echo "▸ Step 4: Verify pending cards"
PENDING=$(curl -s "$BASE/agent-cards?status=pending" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
check "2 pending cards" "2" "$PENDING"
echo ""

# ── Step 5: Director approves both cards ─────────────────
echo "▸ Step 5: Approve Eddie"
EDDIE_APPROVED=$(curl -s -X POST "$BASE/agent-cards/$EDDIE_CARD_ID/approve" \
  -H "Content-Type: application/json" \
  -d '{"approved_by": "director"}')
EDDIE_STATUS=$(echo "$EDDIE_APPROVED" | python3 -c "import sys,json; print(json.load(sys.stdin)['approval_status'])" 2>/dev/null)
EDDIE_AGENT_ID=$(echo "$EDDIE_APPROVED" | python3 -c "import sys,json; print(json.load(sys.stdin).get('agent_id',''))" 2>/dev/null)
check "Eddie approved" "approved" "$EDDIE_STATUS"
echo "  → Agent ID: $EDDIE_AGENT_ID"

echo "▸ Step 5b: Approve Mira"
MIRA_APPROVED=$(curl -s -X POST "$BASE/agent-cards/$MIRA_CARD_ID/approve" \
  -H "Content-Type: application/json" \
  -d '{"approved_by": "director"}')
MIRA_STATUS=$(echo "$MIRA_APPROVED" | python3 -c "import sys,json; print(json.load(sys.stdin)['approval_status'])" 2>/dev/null)
MIRA_AGENT_ID=$(echo "$MIRA_APPROVED" | python3 -c "import sys,json; print(json.load(sys.stdin).get('agent_id',''))" 2>/dev/null)
check "Mira approved" "approved" "$MIRA_STATUS"
echo "  → Agent ID: $MIRA_AGENT_ID"
echo ""

# ── Step 6: Verify agents exist ──────────────────────────
echo "▸ Step 6: Verify agents created"
AGENT_COUNT=$(curl -s "$BASE/agents" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
check "At least 2 agents" "true" "$([ "$AGENT_COUNT" -ge 2 ] && echo true || echo false)"
echo ""

# ── Step 7: Eddie sends heartbeat ────────────────────────
echo "▸ Step 7: Agent heartbeats"
if [ -n "$EDDIE_AGENT_ID" ]; then
  EDDIE_HB=$(curl -s -X POST "$BASE/agents/$EDDIE_AGENT_ID/heartbeat" -o /dev/null -w "%{http_code}")
  check "Eddie heartbeat" "200" "$EDDIE_HB"
fi
if [ -n "$MIRA_AGENT_ID" ]; then
  MIRA_HB=$(curl -s -X POST "$BASE/agents/$MIRA_AGENT_ID/heartbeat" -o /dev/null -w "%{http_code}")
  check "Mira heartbeat" "200" "$MIRA_HB"
fi
echo ""

# ── Step 8: Eddie messages Mira ──────────────────────────
echo "▸ Step 8: Eddie → Mira (task handoff)"
MSG1=$(curl -s -X POST "$BASE/comms/messages" \
  -H "Content-Type: application/json" \
  -d "{
    \"from_agent_id\": \"$EDDIE_AGENT_ID\",
    \"to_agent_id\": \"$MIRA_AGENT_ID\",
    \"subject\": \"Q1 Invoice Reconciliation\",
    \"body\": \"Mira, I need help coordinating the Q1 invoice reconciliation across divisions. Can you check who has outstanding deliverables?\",
    \"priority\": \"routine\",
    \"category\": \"task_handoff\"
  }")
MSG1_ID=$(echo "$MSG1" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
MSG1_CONV=$(echo "$MSG1" | python3 -c "import sys,json; print(json.load(sys.stdin)['conversation_id'])" 2>/dev/null)
MSG1_CODE=$(echo "$MSG1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('type',''))" 2>/dev/null)
check "Message sent (comms.message)" "comms.message" "$MSG1_CODE"
echo "  → Event ID: $MSG1_ID"
echo "  → Conversation: $MSG1_CONV"
echo ""

# ── Step 9: Mira replies ─────────────────────────────────
echo "▸ Step 9: Mira → Eddie (response)"
MSG2=$(curl -s -X POST "$BASE/comms/messages" \
  -H "Content-Type: application/json" \
  -d "{
    \"from_agent_id\": \"$MIRA_AGENT_ID\",
    \"to_agent_id\": \"$EDDIE_AGENT_ID\",
    \"subject\": \"Re: Q1 Invoice Reconciliation\",
    \"body\": \"On it, Eddie. I'll check with Gage and Zeke for outstanding items. Expect a status update within the hour.\",
    \"priority\": \"routine\",
    \"conversation_id\": \"$MSG1_CONV\",
    \"in_reply_to\": \"$MSG1_ID\",
    \"category\": \"response\"
  }")
MSG2_CODE=$(echo "$MSG2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('type',''))" 2>/dev/null)
check "Reply sent" "comms.message" "$MSG2_CODE"
echo ""

# ── Step 10: Director sends flash ────────────────────────
echo "▸ Step 10: Director flash broadcast"
MSG3=$(curl -s -X POST "$BASE/comms/messages" \
  -H "Content-Type: application/json" \
  -d "{
    \"from_agent_id\": \"director\",
    \"to_agent_id\": \"$MIRA_AGENT_ID\",
    \"subject\": \"Priority shift — Fracture Code launch\",
    \"body\": \"All hands: Fracture Code launched March 2. Marketing email to Operatives list is overdue. Mira, coordinate with Eddie on a MailerLite campaign ASAP.\",
    \"priority\": \"flash\",
    \"category\": \"advisory\"
  }")
MSG3_CODE=$(echo "$MSG3" | python3 -c "import sys,json; print(json.load(sys.stdin).get('type',''))" 2>/dev/null)
check "Director flash sent" "comms.message" "$MSG3_CODE"
echo ""

# ── Step 11: Check conversation thread ───────────────────
echo "▸ Step 11: Verify conversation thread"
THREAD=$(curl -s "$BASE/comms/conversations/$MSG1_CONV" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
check "Thread has 2 messages" "2" "$THREAD"
echo ""

# ── Step 12: Check Mira's inbox ──────────────────────────
echo "▸ Step 12: Mira's inbox"
MIRA_INBOX=$(curl -s "$BASE/comms/agents/$MIRA_AGENT_ID/inbox" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
check "Mira has 2+ inbox messages" "true" "$([ "$MIRA_INBOX" -ge 2 ] && echo true || echo false)"
echo ""

# ── Step 13: Check Eddie's inbox ─────────────────────────
echo "▸ Step 13: Eddie's inbox"
EDDIE_INBOX=$(curl -s "$BASE/comms/agents/$EDDIE_AGENT_ID/inbox" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
check "Eddie has 1+ inbox message" "true" "$([ "$EDDIE_INBOX" -ge 1 ] && echo true || echo false)"
echo ""

# ── Step 14: List all conversations ──────────────────────
echo "▸ Step 14: Conversation listing"
CONVOS=$(curl -s "$BASE/comms/conversations" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
check "At least 2 conversations" "true" "$([ "$CONVOS" -ge 2 ] && echo true || echo false)"
echo ""

# ── Step 15: Check dashboard loads ───────────────────────
echo "▸ Step 15: Dashboard pages"
DASH_CARDS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/dashboard/agent-cards")
check "Agent Cards page loads" "200" "$DASH_CARDS"
DASH_COMMS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/dashboard/comms")
check "Comms page loads" "200" "$DASH_COMMS"
echo ""

# ── Summary ──────────────────────────────────────────────
echo "═══════════════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
