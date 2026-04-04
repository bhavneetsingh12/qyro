# QYRO P0 + P1 Fix Instructions
# Use this file with Claude Code to fix critical bugs before onboarding clients.
# Each fix is self-contained. Do one fix per session to stay within token limits.
# Use /model claude-haiku-4-5-20251001 for simple fixes to save tokens.

---

## HOW TO USE THIS FILE

One fix per session. Pattern:
```
/clear
Read CLAUDE.md and QYRO_P0_FIXES.md.
Do Fix [NUMBER] only. Do not touch any other files. /compact when done. Stop.
```

---

## FIX 1 — P0 — Widget chat blocked by Clerk auth
File: apps/api/src/index.ts

Problem: POST /api/v1/assist/chat and POST /api/v1/assist/missed-call
are mounted under the auth-required /api group. The widget has no
Clerk session so every request returns 401.

What to do:
- Find where assistRouter is mounted in index.ts
- Move ONLY these two routes out of the auth group:
  POST /api/v1/assist/chat
  POST /api/v1/assist/missed-call
- Add them as PUBLIC routes (like the voice routes)
- In the assist.ts handler for these two routes:
  validate tenantId by looking it up in the DB directly
  instead of using req.tenant from Clerk middleware
- All other assist routes stay auth-protected

Test: POST /api/v1/assist/chat with no auth header should return
200 (not 401) when a valid tenantId is provided.

---

## FIX 2 — P0 — Session UUID spoken aloud to callers
File: apps/api/src/routes/voice.ts line ~113

Problem: The greeting string appends the session UUID:
  const say = `${reply} Session ID ${session.id}.`;
This is read aloud to every caller.

What to do:
- Find this line in voice.ts
- Change it to: const say = reply;
- Nothing else changes

Test: The greeting string should contain only the AI reply text.

---

## FIX 3 — P0 — Inbound call session ID never passed to turn route
File: apps/api/src/routes/voice.ts

Problem: The inbound /incoming handler calls twimlGatherAndSay(say)
which uses a hardcoded /api/v1/voice/turn URL with no sessionId.
The turn handler needs sessionId to find the session.
Result: every inbound call turn returns "Your session was not found."

What to do:
- Find twimlGatherAndSay() call in the incoming handler
- Replace it with twimlGatherAndSayWithAction() (already exists in
  the file for outbound calls) passing the session ID in the URL:
  /api/v1/voice/turn?sessionId=${session.id}
- Do not change the outbound handler

Test: After the greeting, the TwiML action URL should include
?sessionId=[uuid].

---

## FIX 4 — P0 — No Twilio signature verification on voice routes
File: apps/api/src/routes/voice.ts and apps/api/src/index.ts

Problem: Voice routes are completely public. Anyone can POST fake
Twilio webhooks to trigger AI calls or manipulate call state.

What to do:
- Install twilio SDK if not already: pnpm add twilio --filter @qyro/api
- Create a validateTwilioSignature middleware function in
  apps/api/src/middleware/auth.ts (add it to existing file)
- Use twilio.validateRequest() with TWILIO_AUTH_TOKEN env var
- Apply this middleware to ALL /api/v1/voice/* routes
- Skip validation if NODE_ENV === 'development' (for local testing)
- Add TWILIO_AUTH_TOKEN to .env.example if not present

Test: A POST to /api/v1/voice/incoming without valid
X-Twilio-Signature header should return 403 in production.

---

## FIX 5 — P1 — Voice AI has no memory between turns
File: apps/api/src/routes/voice.ts line ~240

Problem: processTurn is called with history: []
Each turn the AI has no memory of the conversation.
Booking flow is completely broken.

What to do:
- Before calling processTurn, load message history from DB:
  query messageAttempts where sessionId = session.id
  order by createdAt asc
  map to { role, content } format
- Pass loaded history to processTurn
- If turn count > 6, use compact.ts to summarize older turns first
- After processTurn returns, save the new turn to messageAttempts

Test: Send two messages in same session. Second message should
reference context from first message in the AI reply.

---

## FIX 6 — P1 — Wrong session type for inbound voice calls
File: apps/api/src/routes/voice.ts line ~96

Problem: sessionType: "missed_call_sms" is set for inbound voice calls.
This misclassifies all voice calls as SMS in the database.

What to do:
- Find sessionType: "missed_call_sms" in the incoming call handler
- Change to sessionType: "voice_inbound"
- Check if "voice_inbound" is a valid value in the schema
  (assistantSessions.sessionType is text type so any string works)

Test: After an inbound call, assistant_sessions row should have
session_type = 'voice_inbound' not 'missed_call_sms'.

---

## FIX 7 — P1 — Widget sends wrong channel value
File: apps/web/public/widget.js line ~73

Problem: widget.js sends channel: "sms" for website chat.
Website chat is not SMS.

What to do:
- Find channel: "sms" in widget.js
- Change to channel: "chat"
- Check messageAttempts schema to confirm "chat" is acceptable
  (if channel is an enum, may need to add "chat" as a valid value)
- If schema uses enum, also update packages/db/src/schema.ts
  to add "chat" to the channel enum and generate a new migration

Test: Widget message should create messageAttempts row with
channel = 'chat' not 'sms'.

---

## FIX 8 — P1 — Missing env vars in .env.example
File: .env.example

Problem: 12 env vars used in code are not documented.
New deployments will fail silently.

What to do:
Add these to .env.example with placeholder values and comments:

# ─── Twilio ───────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID=AC_REPLACE_ME
TWILIO_AUTH_TOKEN=REPLACE_ME
TWILIO_PHONE_NUMBER=+1REPLACE_ME
PUBLIC_API_BASE_URL=http://localhost:3001

# ─── Voice / Outbound ─────────────────────────────────────────────
OUTBOUND_VOICE_GLOBAL_PAUSED=false
DEFAULT_TIMEZONE=America/Los_Angeles

# ─── Calendar ─────────────────────────────────────────────────────
DEFAULT_CALENDAR_PROVIDER=cal_com
GOOGLE_CALENDAR_ID=REPLACE_ME
CAL_API_KEY=REPLACE_ME
CAL_EVENT_TYPE_ID=REPLACE_ME

# ─── Internal ─────────────────────────────────────────────────────
INTERNAL_TENANT_ID=REPLACE_ME
EXTRA_WEB_ORIGIN=http://localhost:3000
PROMPTS_DIR=docs/PROMPTS

---

## FIX 9 — P2 — DEV_BYPASS_AUTH allowed in production
File: apps/api/src/middleware/tenant.ts

Problem: DEV_BYPASS_AUTH can be accidentally set in production,
disabling all authentication.

What to do:
- At the top of the tenant middleware function add:
  if (process.env.NODE_ENV === 'production' &&
      process.env.DEV_BYPASS_AUTH === 'true') {
    throw new Error('DEV_BYPASS_AUTH cannot be enabled in production');
  }

Test: Setting DEV_BYPASS_AUTH=true with NODE_ENV=production should
throw on startup, not silently bypass auth.

---

## FIX 10 — P2 — Port default mismatch
File: apps/api/src/index.ts line ~16

Problem: .env.example documents PORT=3001 but code defaults to 3005.
Causes port confusion across the project.

What to do:
- Change: const PORT = Number(process.env.PORT ?? 3005)
- To:     const PORT = Number(process.env.PORT ?? 3001)
- Verify .env.example has PORT=3001

Test: Starting API without PORT set should use port 3001.

---

## DOCS TO UPDATE AFTER FIXES

After all P0 fixes are complete, update these docs in one session:

1. QYRO_ASSIST_INSTRUCTIONS.md
   - Mark sessions AA through AI as [x] in the checklist
   - Add note: "P0 fixes applied [date]"

2. docs/DECISIONS.md
   - Add: Widget auth architecture decision (why chat is public)
   - Add: Twilio signature verification approach
   - Add: Channel enum extended with "chat" value

3. docs/ENVIRONMENTS.md
   - Add all 12 new env vars with descriptions

4. CLAUDE.md
   - Update current phase task checklist
   - Add note: "P0 audit fixes complete"

5. PROJECT_STATUS.md (regenerate after fixes)
   - Run the full audit command again after P0 fixes
   - Replace old file with new one

---

## SESSION COMMANDS (copy-paste ready)

Fix 1 (use Haiku — simple route change):
/clear
/model claude-haiku-4-5-20251001
Read CLAUDE.md and QYRO_P0_FIXES.md. Do Fix 1 only. /compact when done. Stop.

Fix 2 (use Haiku — one line change):
/clear
/model claude-haiku-4-5-20251001
Read CLAUDE.md and QYRO_P0_FIXES.md. Do Fix 2 only. /compact when done. Stop.

Fix 3 (use Haiku — route change):
/clear
/model claude-haiku-4-5-20251001
Read CLAUDE.md and QYRO_P0_FIXES.md. Do Fix 3 only. /compact when done. Stop.

Fix 4 (use Sonnet — needs Twilio SDK knowledge):
/clear
Read CLAUDE.md and QYRO_P0_FIXES.md. Do Fix 4 only. /compact when done. Stop.

Fix 5 (use Sonnet — needs DB + compaction logic):
/clear
Read CLAUDE.md and QYRO_P0_FIXES.md. Do Fix 5 only. /compact when done. Stop.

Fixes 6-8 (use Haiku — simple targeted changes):
/clear
/model claude-haiku-4-5-20251001
Read CLAUDE.md and QYRO_P0_FIXES.md. Do Fix [6/7/8] only. /compact when done. Stop.

Fixes 9-10 (use Haiku — one line changes):
/clear
/model claude-haiku-4-5-20251001
Read CLAUDE.md and QYRO_P0_FIXES.md. Do Fix [9/10] only. /compact when done. Stop.

Docs update (use Haiku):
/clear
/model claude-haiku-4-5-20251001
Read CLAUDE.md and QYRO_P0_FIXES.md section "DOCS TO UPDATE AFTER FIXES".
Update all 4 docs listed. Do not change any code. /compact when done. Stop.
