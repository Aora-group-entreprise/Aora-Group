/**
 * AORA GROUP — Supabase Storage gateway.
 * Public downloads are limited to the public/ prefix.
 * Uploads require ADMIN_TOKEN and a server-side Supabase secret key.
 * Never expose SUPABASE_SERVICE_ROLE_KEY in browser code.
 */

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const BUCKET = "aoragroup";
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

function storageBase(env) {
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+\.supabase\.co$/.test(base)) {
    throw new Error("SUPABASE_URL is missing or invalid.");
  }
  return base + "/storage/v1";
}

function storageHeaders(env) {
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY Worker secret.");
  return {
    apikey: key,
    authorization: "Bearer " + key
  };
}

async function health(env) {
  const headers = storageHeaders(env);
  const response = await fetch(storageBase(env) + "/bucket/" + BUCKET, { headers });
  if (!response.ok) {
    throw new Error("Supabase Storage bucket check failed (" + response.status + "). Verify the secret and bucket.");
  }
  return { service: "AORA GROUP storage gateway", status: "connected", provider: "Supabase Storage", bucket: BUCKET };
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
  if (declaredLength > MAX_UPLOAD_BYTES) return json({ error: "File exceeds the 50 MB limit." }, 413);

  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: "Empty file." }, 400);
  if (body.byteLength > MAX_UPLOAD_BYTES) return json({ error: "File exceeds the 50 MB limit." }, 413);

  const contentType = (request.headers.get("Content-Type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return json({ error: "This file type is not allowed." }, 415);
  }

  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const endpoint = storageBase(env) + "/object/" + BUCKET + "/" + encodedKey;
  const headers = {
    ...storageHeaders(env),
    "content-type": contentType,
    "cache-control": "max-age=3600",
    "x-upsert": "true"
  };

  const result = await fetch(endpoint, { method: "POST", headers, body });
  if (!result.ok) {
    let detail = "";
    try {
      const payload = await result.json();
      detail = String(payload.message || payload.error || payload.statusCode || "").slice(0, 240);
    } catch {}
    console.error("Supabase Storage upload failed:", result.status, detail);
    return json({ error: "Supabase Storage upload failed.", upstreamStatus: result.status }, 502);
  }

  return json({
    success: true,
    fileName: key,
    contentType,
    size: body.byteLength,
    publicUrl: storageBase(env).replace("/storage/v1", "") + "/storage/v1/object/public/" + BUCKET + "/" + encodedKey
  }, 201);
}

async function download(request, env, key) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const target = storageBase(env) + "/object/public/" + BUCKET + "/" + encodedKey;
  const headers = {};
  const range = request.headers.get("Range");
  if (range) headers.Range = range;

  const response = await fetch(target, { method: request.method, headers });
  if (!response.ok) {
    return json({ error: response.status === 404 ? "File not found." : "Supabase Storage download failed." },
      response.status === 404 ? 404 : 502);
  }

  const outputHeaders = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "content-disposition"]) {
    const value = response.headers.get(name);
    if (value) outputHeaders.set(name, value);
  }
  outputHeaders.set("cache-control", "public, max-age=300, s-maxage=3600");
  outputHeaders.set("x-content-type-options", "nosniff");
  if (key.toLowerCase().endsWith(".apk")) outputHeaders.set("content-disposition", "attachment");

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
        return json(await health(env), 200, cors);
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
      if (url.pathname === "/api/health" && url.searchParams.get("debug") === "1") {
        return json({ error: "Storage gateway error.", diagnostic: message }, 502, cors);
      }
      return json({ error: "Storage gateway error. Check Worker configuration and Supabase Storage." }, 502, cors);
    }
  }
};
