// Cloudflare deployment trigger: includes the Backblaze bucket authorization fix.
/**
 * AORA GROUP — Private Backblaze B2 gateway.
 * The bucket stays private. Public reads are limited to the public/ prefix.
 * Uploads require a server-side ADMIN_TOKEN; never expose it in browser code.
 */

let cachedAuth = null;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/vnd.android.package-archive",
  "application/octet-stream",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/zip",
  "text/plain"
]);

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "*";
  const originAllowed = allowed === "*" || origin === allowed;
  return {
    "access-control-allow-origin": originAllowed ? (allowed === "*" ? "*" : origin) : "null",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, Range",
    "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
    "access-control-max-age": "86400",
    "vary": "Origin",
    "x-content-type-options": "nosniff"
  };
}

function safeKey(raw) {
  try {
    const key = decodeURIComponent(raw || "").replace(/^\/+/, "");
    if (!key || key.length > 900 || key.includes("\\") ||
        key.split("/").some(part => !part || part === "." || part === "..") ||
        !key.startsWith("public/") ||
        !/^[A-Za-z0-9._/-]+$/.test(key)) return null;
    return key;
  } catch {
    return null;
  }
}

async function authorize(env) {
  if (cachedAuth && cachedAuth.expiresAt > Date.now() + 60_000) return cachedAuth;

  // These two secrets must come from the SAME Backblaze Application Key:
  // B2_KEY_ID = keyID; B2_APPLICATION_KEY = applicationKey (secret).
  // Trim accidental whitespace from dashboard copy/paste without logging either value.
  const keyId = String(env.B2_KEY_ID || "").trim();
  const applicationKey = String(env.B2_APPLICATION_KEY || "").trim();
  if (!keyId || !applicationKey) {
    throw new Error("Missing Backblaze credentials: configure B2_KEY_ID and B2_APPLICATION_KEY as Worker secrets.");
  }
  const basic = btoa(keyId + ":" + applicationKey);
  const response = await fetch("https://api.backblazeb2.com/b2api/v4/b2_authorize_account", {
    headers: { Authorization: "Basic " + basic }
  });
  if (!response.ok) {
    // Preserve Backblaze's non-secret error code/message for opt-in diagnostics.
    let detail = "";
    try {
      const failure = await response.json();
      const code = typeof failure.code === "string" ? failure.code : "";
      const message = typeof failure.message === "string" ? failure.message : "";
      detail = [code, message].filter(Boolean).join(": ").slice(0, 300);
    } catch {
      detail = "";
    }
    const safeKeyId = keyId;
    const safeSecretLength = applicationKey.length;
    throw new Error("Backblaze authorization failed (" + response.status + ")" +
      (detail ? ": " + detail : ".") +
      " [B2_KEY_ID=" + safeKeyId +
      "; B2_APPLICATION_KEY_length=" + safeSecretLength + "]");
  }

  const data = await response.json();
  const storage = data.apiInfo?.storageApi;
  const allowed = storage?.allowed || {};
  // Backblaze B2 Native API returns a single bucketId/bucketName for
  // bucket-restricted application keys; it does not return allowed.buckets[].
  const bucketAllowed = allowed.bucketId === env.B2_BUCKET_ID;
  const capabilities = allowed.capabilities || [];

  if (!storage?.apiUrl || !storage?.downloadUrl || !bucketAllowed) {
    // Bucket IDs/names are identifiers, not credentials; include them in opt-in
    // health diagnostics so dashboard/config mismatches can be identified safely.
    const actualBucketId = typeof allowed.bucketId === "string" ? allowed.bucketId : "not-restricted-or-not-returned";
    const actualBucketName = typeof allowed.bucketName === "string" ? allowed.bucketName : "not-returned";
    throw new Error(
      "Backblaze bucket mismatch: configured B2_BUCKET_ID=" + String(env.B2_BUCKET_ID) +
      "; key allowed.bucketId=" + actualBucketId +
      "; key allowed.bucketName=" + actualBucketName + "."
    );
  }
  if (!capabilities.includes("readFiles") || !capabilities.includes("writeFiles")) {
    throw new Error("The Backblaze key must include readFiles and writeFiles permissions.");
  }

  cachedAuth = {
    apiUrl: storage.apiUrl,
    downloadUrl: storage.downloadUrl,
    authorizationToken: data.authorizationToken,
    expiresAt: Date.now() + 23 * 60 * 60 * 1000
  };
  return cachedAuth;
}

async function getUploadTarget(auth, env) {
  const endpoint = new URL(auth.apiUrl + "/b2api/v4/b2_get_upload_url");
  endpoint.searchParams.set("bucketId", env.B2_BUCKET_ID);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: auth.authorizationToken }
  });
  if (!response.ok) throw new Error("Could not obtain a Backblaze upload URL (" + response.status + ").");
  return response.json();
}

async function upload(request, env) {
  const supplied = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || supplied !== "Bearer " + env.ADMIN_TOKEN) {
    return json({ error: "Unauthorized." }, 401);
  }

  const url = new URL(request.url);
  const key = safeKey(url.searchParams.get("key") || "");
  if (!key) return json({ error: "Invalid key. Use public/<folder>/<filename>." }, 400);

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_UPLOAD_BYTES) return json({ error: "File exceeds the 100 MB limit." }, 413);

  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: "Empty file." }, 400);
  if (body.byteLength > MAX_UPLOAD_BYTES) return json({ error: "File exceeds the 100 MB limit." }, 413);

  const contentType = (request.headers.get("Content-Type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return json({ error: "This file type is not allowed." }, 415);
  }

  const auth = await authorize(env);
  const uploadInfo = await getUploadTarget(auth, env);
  const digest = await crypto.subtle.digest("SHA-1", body);
  const sha1 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const encodedName = key.split("/").map(encodeURIComponent).join("%2F");

  const result = await fetch(uploadInfo.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: uploadInfo.authorizationToken,
      "X-Bz-File-Name": encodedName,
      "Content-Type": contentType,
      "X-Bz-Content-Sha1": sha1
    },
    body
  });
  if (!result.ok) {
    const status = result.status;
    // B2 upload URLs/tokens can be invalidated after a failed upload. The next
    // request obtains a fresh target; do not expose Backblaze's raw response.
    return json({ error: "Backblaze upload failed.", upstreamStatus: status }, 502);
  }

  const saved = await result.json();
  return json({ success: true, fileName: saved.fileName, contentType, size: body.byteLength }, 201);
}

async function download(request, env, key) {
  const auth = await authorize(env);
  const encodedName = key.split("/").map(encodeURIComponent).join("/");
  const target = auth.downloadUrl + "/file/" + encodeURIComponent(env.B2_BUCKET_NAME) + "/" + encodedName;
  const headers = { Authorization: auth.authorizationToken };
  const range = request.headers.get("Range");
  if (range) headers.Range = range;

  const response = await fetch(target, { method: request.method, headers });
  if (!response.ok) {
    return json({ error: response.status === 404 ? "File not found." : "Backblaze download failed." },
      response.status === 404 ? 404 : 502);
  }

  const outputHeaders = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "content-disposition"]) {
    const value = response.headers.get(name);
    if (value) outputHeaders.set(name, value);
  }
  outputHeaders.set("cache-control", "public, max-age=300, s-maxage=3600");
  outputHeaders.set("x-content-type-options", "nosniff");
  if (key.toLowerCase().endsWith(".apk")) {
    outputHeaders.set("content-disposition", "attachment");
  }
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers: outputHeaders
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        if (!env.B2_KEY_ID || !env.B2_APPLICATION_KEY || !env.B2_BUCKET_ID ||
            !env.B2_BUCKET_NAME || !env.ADMIN_TOKEN) {
          return json({ service: "AORA GROUP storage gateway", status: "missing_configuration" }, 503, cors);
        }
        await authorize(env);
        return json({ service: "AORA GROUP storage gateway", status: "connected", bucket: env.B2_BUCKET_NAME }, 200, cors);
      }

      if (url.pathname === "/api/upload" && request.method === "POST") {
        const response = await upload(request, env);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(cors)) headers.set(name, value);
        return new Response(response.body, { status: response.status, headers });
      }

      if (url.pathname.startsWith("/files/") && (request.method === "GET" || request.method === "HEAD")) {
        const key = safeKey(url.pathname.slice("/files/".length));
        if (!key) return json({ error: "Invalid file path." }, 400, cors);
        const response = await download(request, env, key);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(cors)) headers.set(name, value);
        return new Response(response.body, { status: response.status, headers });
      }

      return json({ error: "Not found." }, 404, cors);
    } catch (error) {
      console.error("AORA storage gateway error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      // Temporary, opt-in diagnostics for health checks; never returns credentials.
      if (url.pathname === "/api/health" && url.searchParams.get("debug") === "1") {
        return json({
          error: "Storage gateway error.",
          diagnostic: message
        }, 502, cors);
      }
      return json({ error: "Storage gateway error. Check Worker logs and Backblaze key permissions." }, 502, cors);
    }
  }
};
