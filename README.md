## Rettiwt-API Microservice (for n8n/automation)

Small Express microservice that wraps the Rettiwt-API to interact with X (Twitter), verify authentication, and optionally POST results to a callback URL for async automation (e.g., n8n).

References:
- Rettiwt-API repository and docs: `https://github.com/Rishikant181/Rettiwt-API`

### Installation

```bash
cd /home/auto/rettiwt-service
npm install
```

### Configure

Create a `.env` file based on the variables below:

- `PORT` (default: 8787)
- `RETTIWT_API_KEY` — API key generated via Rettiwt-API Authentication flow (uses X cookies). See project docs.
- `ALLOW_GUEST` — set to `false` to require `RETTIWT_API_KEY`
- `CORS_ORIGIN` — default `*`
- `CALLBACK_SECRET` — optional HMAC secret for signing callback payloads
- `REQUEST_TIMEOUT_MS` — default `30000`
- `VERIFY_RESOURCE` — resource to call for auth verification (choose a user-only resource)
- `VERIFY_ARGS_JSON` — JSON string for arguments passed to `VERIFY_RESOURCE`

Example:

```bash
PORT=8787
RETTIWT_API_KEY=your_rettiwt_api_key
ALLOW_GUEST=false
VERIFY_RESOURCE=USER_BOOKMARKS
VERIFY_ARGS_JSON={"count":1}
```

### Run

```bash
npm run dev
# or
npm run build && npm start
```

### API

- `GET /health` — liveness probe

- `GET /auth/verify`
  - Uses `VERIFY_RESOURCE`/`VERIFY_ARGS_JSON` when set
  - Ad-hoc override: `?resourceType=...&args=...` where `args` is JSON string
  - Returns `{ ok: true, resource, sample }` on success

- `POST /auth/probe`
  - Body `{ resourceType: string, args?: object }`
  - Calls any resource and returns a sample, useful to test auth/resources

- `POST /api/request`
  - Body:
    ```json
    {
      "resourceType": "USER_DETAILS_BY_USERNAME",
      "args": { "id": "jack" },
      "callbackUrl": "https://your-n8n-webhook",
      "callbackHeaders": { "x-api-key": "..." }
    }
    ```
  - If `callbackUrl` is provided: returns `202` immediately and POSTs the result to the callback
  - Otherwise returns the result synchronously

- `GET /api/resources/resource-types`
  - Returns `{ ok: true, keys: string[], mapping: { KEY: VALUE } }` listing all `ResourceType`s.

- `GET /api/resources/:resourceType`
  - Query: `args` (JSON string)
  - Example:
    ```
    GET /api/resources/USER_DETAILS_BY_USERNAME?args={"id":"jack"}
    ```
  - Returns `{ ok: true, resource, data }`

- `POST /api/resources/:resourceType`
  - Body:
    ```json
    {
      "args": { "id": "jack" },
      "callbackUrl": "https://your-n8n-webhook",
      "callbackHeaders": { "x-api-key": "..." }
    }
    ```
  - Returns `{ ok: true, resource, data }` (sync) or `202` and posts to callback (async)

Notes:
- `resourceType` can be either the `ResourceType` enum key or its value.
- This service uses `FetcherService` to return the raw Rettiwt response as JSON.
- For JSON-serializable models returned by Rettiwt wrappers, prefer using their `.toJSON()` (see Rettiwt docs).

### n8n usage

Use the HTTP Request node to call:
- URL: `http://<host>:8787/api/request`
- Method: POST
- JSON body: the same payload as described above

Alternate:
- Discover types: `GET http://<host>:8787/api/resources/resource-types`
- Call any resource:
  - GET `http://<host>:8787/api/resources/USER_DETAILS_BY_USERNAME?args={"id":"jack"}`
  - POST `http://<host>:8787/api/resources/USER_BOOKMARKS` with body `{"args":{"count":1}}`

Async pattern:
1) Create an n8n Webhook Trigger node.
2) Use its public URL as `callbackUrl`.
3) Optionally set `CALLBACK_SECRET` so the service sends `x-signature-sha256` header; verify inside n8n Function node.

### Tweet trigger (subscribe to users and receive callbacks on new posts)

- Create a subscription:
  ```bash
  curl -s -X POST http://localhost:8787/api/triggers/user-tweets/subscribe \
    -H 'content-type: application/json' \
    -d '{
      "callbackUrl":"https://your-n8n-webhook",
      "intervalMs": 30000,
      "deliverBacklog": false,
      "users":[{"username":"jack"},{"username":"elonmusk"}]
    }' | jq
  ```
  - Returns `{ ok: true, subscriptionId }`.
  - deliverBacklog=false boots with the latest tweet as last seen and does not send historical tweets on first run.

- Add more users later:
  ```bash
  curl -s -X POST http://localhost:8787/api/triggers/user-tweets/add-users \
    -H 'content-type: application/json' \
    -d '{"subscriptionId":"<id>","users":[{"username":"twitter"}]}' | jq
  ```

- List subscriptions:
  ```bash
  curl -s http://localhost:8787/api/triggers/user-tweets | jq
  ```

- Unsubscribe:
  ```bash
  curl -s -X POST http://localhost:8787/api/triggers/user-tweets/unsubscribe \
    -H 'content-type: application/json' \
    -d '{"subscriptionId":"<id>"}' | jq
  ```

Payload posted to your `callbackUrl` for each new tweet:
```json
{
  "event": "user.tweet.created",
  "subscriptionId": "sub_...",
  "user": { "id": "123456", "username": "jack" },
  "tweet": { "...": "Tweet JSON (from Rettiwt .toJSON())" }
}
```
If `CALLBACK_SECRET` is set in `.env`, each POST includes `x-signature-sha256` header for verification.

### Auth verification tips

To truly verify user authentication, set `VERIFY_RESOURCE` to a resource that requires a logged-in user (e.g., bookmarks, followed feed, etc.) in accordance with the Rettiwt-API resource list. Public resources (e.g., user details by username) only prove connectivity, not user auth.


