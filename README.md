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

Long-running poller (default every 60s):

```bash
pnpm start
```

One-shot (for cron / launchd):

```bash
pnpm run once
```

The first successful poll writes all current `signals` into `state.json` **without** sending alerts (baseline). Later polls only notify on **new** signal IDs.

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
| `POLL_INTERVAL_MS` | `60000` | Poll interval for `pnpm start` |
| `STATE_PATH` | `./state.json` | Known signal IDs |
| `BASE_URL` | `https://terminal.emini.today` | Terminal origin |
