# X ChromaBot API

Errors: `{ "success": false, "error": "<message>" }` with a real HTTP status (400 validation, 401 auth,
404 unknown id, 500 unexpected). Unknown context ids return 404.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/status` | Settings, contexts, next posts, stats, queue, latest log |
| GET | `/api/rate-limits` | Telemetry and cooldown state |
| POST | `/api/cooldown/clear` | Clears the global cooldown |
| GET | `/api/contexts` | Contexts, active id, next posts |
| POST | `/api/contexts` | Create a context (400 on invalid body) |
| PUT | `/api/contexts/:id` | Update (404 unknown id) |
| DELETE | `/api/contexts/:id` | Delete (404 unknown id, 400 if last context) |
| POST | `/api/contexts/:id/activate` | 404 unknown id |
| POST | `/api/contexts/:id/toggle` | 404 unknown id |
| POST | `/api/contexts/:id/duplicate` | 404 unknown id |
| POST | `/api/contexts/:id/reset-chain` | 404 unknown id |
| POST | `/api/contexts/:id/clear-history` | 404 unknown id |
| POST | `/api/contexts/:id/trigger` | Body `{ slotType?, forceLive? }`; 404 unknown id |
| POST | `/api/settings` | Update global settings |
| POST | `/api/credentials` | Save X credentials (blank/missing fields keep stored values; 400 without `CREDENTIALS_ENCRYPTION_KEY`) |
| DELETE | `/api/credentials/:method` | Remove stored credentials for `oauth1`, `oauth2` or `bearer` |
| POST | `/api/twitter/verify` | Verify credentials; failure is `{ valid:false, message }` |
| POST | `/api/generate-color` | Body `{ slotType?, color?, contextId?, template? }` |
| POST | `/api/template/preview` | Body `{ template?, color?, slotType?, contextId? }` |
| POST | `/api/post-now` | Body `{ contextId?, slotType?, color?, forceLive? }`; 404 unknown `contextId` |
| ALL | `/api/cron/trigger`, `/api/webhook/trigger` | Secret via `?secret=`, `x-cron-secret` or body; `contextId`/`slot`/`forceLive`; 404 unknown `contextId` |
| GET | `/api/queue` | Optional `?contextId=` |
| POST | `/api/queue/regenerate` | Body or query `contextId` |
| POST | `/api/queue/reroll` | Body `{ slotId }`; 400 missing, 404 unknown slot |
| GET | `/api/history` | `{ logs }` |
| DELETE | `/api/history` | Clears logs |
| GET | `/api/export-script` | Standalone GitHub Actions YAML and Node poster |
