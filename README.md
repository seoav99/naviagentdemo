# Wayfinder · Smart Navigation AI prototype

An English-language voice and chat prototype for the Seoul-to-Gyeongju drive. The five scenarios are sample prompts, not a required sequence. This folder is self-contained and can be used as the root of a Render deployment repository.

## Public preview on Render

`render.yaml` creates a small Docker-based Render web service in Singapore. It serves the mobile view at `/mobile` and the desktop view at `/`. Render provides the public `onrender.com` URL after the first successful deploy.

1. Put this folder in a Git repository that your Render account can access, then create a Render Blueprint from that repository and select `render.yaml`.
2. During Blueprint setup, enter the prompted secret values: `OPENAI_API_KEY` should be a **new key** from a dedicated OpenAI API project; `DEMO_ACCESS_CODE` should be a separate random code of at least 16 characters that you will share privately with testers. These values are not stored in this repository or sent to the browser.
3. Deploy the service. Open its `onrender.com` address (or add `/mobile` for the mobile layout) and enter the access code.

The deployed site keeps the OpenAI key on the server, uses an HttpOnly access cookie, allows 10 failed code attempts per IP every 15 minutes, and limits shared-key API requests in memory (up to 20 text turns per minute and 120/hour per browser session, capped at 300 turns/hour for everyone). Realtime session creation is limited to 4/hour and 12/day per browser, capped at 60 sessions/hour globally; each connected voice session ends after 30 minutes. Configure an OpenAI project usage/spend limit as an extra budget guardrail; application rate limits are not a replacement for billing controls. In-memory limits reset when the service restarts or redeploys.

The Blueprint uses Render's Free web service plan for a lightweight preview. Free services sleep after 15 minutes without traffic and can take about a minute to wake, so the first visit or voice turn after idle may be slow. Move the service to a paid plan if you need it to remain responsive. See Render's [Blueprint YAML reference](https://render.com/docs/blueprint-spec) and [free service limits](https://render.com/docs/free).

**Key safety:** an API key was previously pasted into the conversation. Revoke that key before publishing, and configure a newly created key only in Render's secret environment setting. Never put either secret in this repository, browser code, or a public message.

## Run locally

Requires Node.js 18 or later; there are no npm dependencies.

1. Double-click `Start-Wayfinder.command`, or open this folder in a terminal and run `node server.mjs`.
2. Open <http://127.0.0.1:4173> or <http://127.0.0.1:4173/mobile>.
3. Click the API status/settings and enter a new key. Locally it stays in server memory and clears when the process exits. Or set `OPENAI_API_KEY` in the server environment before launch.
4. Click **Start voice** once and allow microphone access. The WebRTC session stays active across turns; server VAD starts a response when you finish speaking. Use **End voice** or say “stop listening” to end it. Speak naturally in English; the five example prompts are optional.

The server binds to `127.0.0.1` by default. Render overrides `HOST` to `0.0.0.0` and supplies its port through `PORT`.

If OpenAI returns HTTP 429, the prototype shows the provider error code and any `Retry-After` value. Billing or quota errors require a billing/limit change; a temporary rate limit may clear after the indicated delay.

## Prototype architecture and limits

- **Voice path:** browser microphone and speaker ↔ GPT-Realtime-2.1 over WebRTC ↔ server-side AI gateway.
- **Model routing:** conversation, gratitude, jokes, and stop requests route to GPT-6 Luna. Route, traffic, fuel, and trip-report requests route to GPT-6.1 Sol.
- **Function calls:** route, detour, nearby-fuel, and trip-report functions return the attached fixture data.
- **Scenario data:** `data/scenarios.json` contains the driver profile, example utterances, tool schemas, and mock backend responses.

The prototype does not connect a vector database, map provider, traffic feed, or live fuel-price source. The route, traffic, station, and price details are illustrative fixtures, and the map is decorative. When the driver indicates the trip is complete, the assistant offers a trip-report email. After clear consent it prepares a simulated report preview; no email service is connected and **no email is actually sent**.

The original briefing also describes text-embedding RAG and web search; those services are not wired into this demo. The implementation follows the voice, gateway, tiered-model, function-calling, and fixture-backend parts of the architecture.
