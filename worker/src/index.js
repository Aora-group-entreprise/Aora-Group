/**
 * AORA GROUP — Private Backblaze B2 gateway
 * Uploads require ADMIN_TOKEN. Reads are exposed only under public/ so the
 * public app catalogue can serve published assets while the B2 bucket stays private.
 */
let cachedAuth = null;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "";
  const originAllowed = allowed === "*" || origin === allowed;
  return {
    "access-control-allow-origin": originAllowed ? (allowed === "*" ? "*" : origin) : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function safeKey(raw) {
  const key = decodeURIComponent(raw || "").replace(/^\/+/, "");
  if (!key || key.length > 900 || key.includes("\\") ||
      key.split("/").some(part => !part || part === "." || part === "..") ||
      !key.startsWith("public/")) return null;
  return key;
}

async function authorize(env) {
  if (cachedAuth && cachedAuth.expiresAt > Date.now() + 60_000) return cachedAuth;
  const basic = btoa(env.B2_KEY_ID + ":" + env.B2_APPLICATION_KEY);
  const response = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
    headers: { Authorization: "Basic " + basic },
  });
  if (!response.ok) throw new Error("Backblaze authorization failed (" + response.status + ")");
  const data = await response.json();
  if (data.allowed?.bucketId && data.allowed.bucketId !== env.B2_BUCKET_ID) {
    throw new Error("Application key is not scoped to the configured bucket");
  }
  cachedAuth = {
    apiUrl: data.apiUrl,
    downloadUrl: data.downloadUrl,
    authorizationToken: data.authorizationToken,
    expiresAt: Date.now() + 23 * 60 * 60 * 1000,
  };
  return cachedAuth;
}

async function upload(request, env) {
  const supplied = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || supplied !== "Bearer " + env.ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }
  const url = new URL(request.url);
  const key = safeKey(url.searchParams.get("key") || "");
  if (!key) return json({ error: "Invalid key. Use public/<folder>/<filename>." }, 400);

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 100 * 1024 * 1024) return json({ error: "File exceeds 100 MB limit." }, 413);
  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: "Empty file." }, 400);
  if (body.byteLength > 100 * 1024 * 1024) return json({ error: "File exceeds 100 MB limit." }, 413);

  const auth = await authorize(env);
  const uploadInfoResponse = await fetch(auth.apiUrl + "/b2api/v3/b2_get_upload_url", {
    method: "POST",
    headers: {
      Authorization: auth.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bucketId: env.B2_BUCKET_ID }),
  });
  if (!uploadInfoResponse.ok) return json({ error: "Could not obtain B2 upload URL." }, 502);
  const uploadInfo = await uploadInfoResponse.json();
  const digest = await crypto.subtle.digest("SHA-1", body);
  const sha1 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";

  const result = await fetch(uploadInfo.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: uploadInfo.authorizationToken,
      "X-Bz-File-Name": key.split("/").map(encodeURIComponent).join("%2F"),
      "Content-Type": contentType,
      "X-Bz-Content-Sha1": sha1,
    },
    body,
  });
  if (!result.ok) return json({ error: "Backblaze upload failed (" + result.status + ")." }, 502);
  const saved = await result.json();
  return json({ success: true, fileName: saved.fileName, contentType, size: body.byteLength });
}

async function download(request, env, key) {
  const auth = await authorize(env);
  const encodedName = key.split("/").map(encodeURIComponent).join("/");
  const target = auth.downloadUrl + "/file/" + encodeURIComponent(env.B2_BUCKET_NAME) + "/" + encodedName;
  const response = await fetch(target, {
    headers: { Authorization: auth.authorizationToken },
  });
  if (!response.ok) return json({ error: response.status === 404 ? "File not found." : "Backblaze download failed." }, response.status === 404 ? 404 : 502);
  const headers = new Headers();
  headers.set("content-type", response.headers.get("content-type") || "application/octet-stream");
  headers.set("cache-control", "public, max-age=300, s-maxage=3600");
  headers.set("x-content-type-options", "nosniff");
  const disposition = response.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  return new Response(response.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ service: "AORA GROUP storage gateway", status: "ok" }, 200, cors);
      }
      if (url.pathname === "/api/upload" && request.method === "POST") {
        const response = await upload(request, env);
        const headers = new Headers(response.headers);
        for (const [k, v] of Object.entries(cors)) headers.set(k, v);
        return new Response(response.body, { status: response.status, headers });
      }
      if (url.pathname.startsWith("/files/") && request.method === "GET") {
        const key = safeKey(url.pathname.slice("/files/".length));
        if (!key) return json({ error: "Invalid file path." }, 400, cors);
        const response = await download(request, env, key);
        const headers = new Headers(response.headers);
        for (const [k, v] of Object.entries(cors)) headers.set(k, v);
        return new Response(response.body, { status: response.status, headers });
      }
      return json({ error: "Not found" }, 404, cors);
    } catch (error) {
      return json({ error: "Storage gateway error", detail: error.message }, 502, cors);
    }
  },
};
