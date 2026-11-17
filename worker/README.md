# AORA GROUP — Backblaze B2 storage gateway

Cloudflare Worker gateway for the private `aoragroup` Backblaze B2 bucket.

## Routes

- `GET /api/health` — gateway health check (does not test B2 credentials).
- `POST /api/upload?key=public/apps/example.apk` — upload raw file bytes. Requires `Authorization: Bearer <ADMIN_TOKEN>`. Maximum 100 MB.
- `GET /files/public/apps/example.apk` — streams a published object from the private B2 bucket. Only keys under `public/` are readable.

The bucket remains private. The Worker keeps B2 credentials server-side and proxies published downloads. Do not put B2 keys or the admin token in frontend JavaScript or GitHub.

## Configure secrets

From the `worker` directory, run:

```bash
npx wrangler secret put B2_KEY_ID
npx wrangler secret put B2_APPLICATION_KEY
npx wrangler secret put ADMIN_TOKEN
```

Enter the values in the terminal prompt; never commit them. Use the application key restricted to the `aoragroup` bucket with read/write permissions.

## Deploy

1. Install Node.js on your computer.
2. In this directory run `npm install --save-dev wrangler` (or use `npx wrangler`).
3. Set `ALLOWED_ORIGIN` in `wrangler.toml` to the exact Cloudflare Pages production origin.
4. Run `npx wrangler deploy`.
5. Save the deployed Worker URL. Do not add secrets to GitHub.

## Test

Health:

```bash
curl https://YOUR-WORKER.workers.dev/api/health
```

Upload:

```bash
curl -X POST "https://YOUR-WORKER.workers.dev/api/upload?key=public/test/hello.txt" \\
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \\
  -H "Content-Type: text/plain" \\
  --data-binary "AORA GROUP B2 test"
```

Read back:

```bash
curl -i "https://YOUR-WORKER.workers.dev/files/public/test/hello.txt"
```

Delete the test object from the Backblaze console when validation is complete.

## Security notes

- Never use a broad account master key; use the bucket-scoped application key.
- Keep `ADMIN_TOKEN` private and rotate it if exposed.
- Public downloads are intentionally limited to the `public/` prefix. Do not upload confidential files there.
- This Worker does not implement listing or deletion.
- Configure a restrictive Cloudflare rate limit before large public distribution.
