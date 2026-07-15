# SPX3 signal alerts (ntfy)

Polls E.T. Terminal’s authenticated SPX3 view for new chart **signals** and pushes each one to an [ntfy](https://ntfy.sh) topic.

## Setup

```bash
cp .env.example .env
# edit .env: TERMINAL_EMAIL, TERMINAL_PASSWORD, NTFY_TOPIC
pnpm install
```

Pick a hard-to-guess `NTFY_TOPIC` (anyone who knows it can subscribe). Prefer a private/authenticated topic with `NTFY_TOKEN` if you self-host or use access control.

## Subscribe

- **Phone:** install the ntfy app and subscribe to your topic  
- **CLI:** `ntfy subscribe <your-topic>`  
- **Browser:** open `https://ntfy.sh/<your-topic>` (or your `NTFY_BASE_URL`)

## Run

Long-running poller (every **30s** during **06:00–15:00 America/New_York**; idle outside that window):

```bash
pnpm start
```

One-shot (ignores the schedule — for cron / manual checks):

```bash
pnpm run once
```

The first successful poll writes all current `signals` into `state.json` **without** sending alerts (baseline). Later polls only notify on **new** signal IDs.

## Chrome extension (alerts + flow pills)

Reuses your **existing Chrome login** to Terminal (no password stored). Polls `spx3-view`, notifies via **Chrome notifications** and **ntfy**, and injects bias / near-cross pills on `/user/spx3`.

```bash
cd chrome-extension
pnpm install
pnpm build
```

Load the extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `chrome-extension/dist`
4. Log into [E.T. Terminal](https://terminal.emini.today) in the same Chrome profile
5. Open the extension popup → set **ntfy topic** (optional but recommended) → **Save**
6. Visit `https://terminal.emini.today/user/spx3` — pills appear top-right

Popup includes **Test notification** (Chrome + ntfy) so you can verify your topic without waiting for a market event.

Pills:

- **Bullish / Bearish / Neutral** from last `retailFlowSeries[].colorRole`
- **Near cross** when `|retail − inst|` is below the configurable threshold (default `5`)

## launchd (macOS, optional)

Create `~/Library/LaunchAgents/com.eterminal.spx3-alerts.plist` pointing `WorkingDirectory` at this repo and `ProgramArguments` at `pnpm` / `start`, then keep it running — or schedule `pnpm run once` on a timer.

## Env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `TERMINAL_EMAIL` | — | Terminal account email |
| `TERMINAL_PASSWORD` | — | Terminal account password |
| `NTFY_TOPIC` | — | ntfy topic name |
| `NTFY_BASE_URL` | `https://ntfy.sh` | ntfy server |
| `NTFY_TOKEN` | — | Optional bearer token |
| `POLL_INTERVAL_MS` | `30000` | Poll interval while inside 06:00–15:00 ET |
| `STATE_PATH` | `./state.json` | Known signal IDs |
| `BASE_URL` | `https://terminal.emini.today` | Terminal origin |
