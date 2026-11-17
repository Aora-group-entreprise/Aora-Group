# AORA GROUP — Backblaze B2 storage gateway

Cloudflare Worker gateway for the private Backblaze B2 bucket `aoragroup`.

## Routes

- `GET /api/health` — verifies that the Worker is configured and can authenticate with Backblaze.
- `POST /api/upload?key=public/apps/example.apk` — uploads raw file bytes. Requires `Authorization: Bearer <ADMIN_TOKEN>`. Maximum 100 MB. Supported types: APK/octet-stream, JPEG, PNG, WebP, SVG, PDF, ZIP, and plain text.
- `GET|HEAD /files/public/apps/example.apk` — streams a published object from the private B2 bucket. Supports byte-range requests for resumable downloads. Only names under `public/` can be read.

The bucket remains private. The Worker uses the Backblaze B2 Native API v4 and keeps all credentials server-side. No SDK or third-party runtime dependency is required.

## 1. Configure Cloudflare secrets

These values must be created as **Worker secrets**, not plaintext variables and never committed to GitHub:

- `B2_KEY_ID`: the Backblaze Application Key ID.
- `B2_APPLICATION_KEY`: the Backblaze Application Key (secret).
- `ADMIN_TOKEN`: a long, random token used only by a trusted administrator or private upload tool.

From this directory, run:

```bash
npx wrangler secret put B2_KEY_ID
npx wrangler secret put B2_APPLICATION_KEY
npx wrangler secret put ADMIN_TOKEN
```

Paste each value only into the terminal prompt. Alternatively, in Cloudflare Dashboard open Workers & Pages → `aora-group-storage` → Settings → Variables and Secrets, then add each as type **Secret**.

The Backblaze application key must be restricted to bucket `aoragroup` and include `readFiles` + `writeFiles` permissions. Do not use the account master key.

## 2. Deploy

Install Node.js, then from this directory run:

```bash
npx wrangler login
npx wrangler deploy
```

Wrangler publishes the Worker and prints its URL, usually:
`https://aora-group-storage.<your-subdomain>.workers.dev`.

## 3. Restrict the website origin

Before production, replace `ALLOWED_ORIGIN = "*"` in `wrangler.toml` with the exact AORA GROUP Pages origin or custom domain, then deploy again. Example: `https://aora-group.pages.dev`.

The public website must never contain `ADMIN_TOKEN`, `B2_KEY_ID`, or `B2_APPLICATION_KEY`. The upload endpoint is intended for a trusted private admin tool or server-side workflow, not direct calls from public frontend JavaScript.

## 4. Test the connection

Health check (should return `"status":"connected"`):

```bash
curl https://YOUR-WORKER-URL/api/health
```

Upload a test file (run locally; the token is not part of the repository):

```bash
curl -X POST "https://YOUR-WORKER-URL/api/upload?key=public/test/hello.txt" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: text/plain" \
  --data-binary "AORA GROUP B2 test"
```

Read it back:

```bash
curl -i "https://YOUR-WORKER-URL/files/public/test/hello.txt"
```

For large downloads, the Worker forwards standard HTTP Range requests.

## Security notes

- The B2 bucket stays private; no bucket listing or deletion route is exposed.
- Reads are restricted to the `public/` prefix.
- Uploads require the private admin bearer token and are restricted to the `public/` prefix.
- The Worker checks that the B2 application key is bucket-scoped and has read/write file permissions.
- Errors returned to clients do not include Backblaze authorization details.
- The 100 MB limit is an application guard. Validate the Cloudflare account's request-size limits before production APK uploads.
