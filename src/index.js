const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const STORY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function validStory(value) {
  const story = cleanText(value, 80);
  return STORY_RE.test(story) ? story : null;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

function bytes(value) {
  return new TextEncoder().encode(value);
}

function constantTimeEqual(a, b) {
  const left = bytes(a);
  const right = bytes(b);
  if (left.length !== right.length) return false;
  return crypto.subtle.timingSafeEqual(left, right);
}

function isAdmin(request, env) {
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  return Boolean(env.ADMIN_PASSWORD && supplied && constantTimeEqual(supplied, env.ADMIN_PASSWORD));
}

async function readJson(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    throw new Error("JSON_REQUIRED");
  }
  const size = Number(request.headers.get("content-length") || 0);
  if (size > 8192) throw new Error("TOO_LARGE");
  return request.json();
}

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS story_views (story TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT (unixepoch()))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, story TEXT NOT NULL, name TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')), created_at INTEGER NOT NULL DEFAULT (unixepoch()))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS comments_story_status_created_idx ON comments (story, status, created_at)")
  ]);
}

async function handleApi(request, env, url) {
  if (request.method === "POST" && url.pathname === "/api/views") {
    if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
    const body = await readJson(request);
    const story = validStory(body.story);
    if (!story) return json({ error: "Invalid story" }, 400);
    await env.DB.prepare(
      "INSERT INTO story_views (story, views, updated_at) VALUES (?, 1, unixepoch()) ON CONFLICT(story) DO UPDATE SET views = views + 1, updated_at = unixepoch()"
    ).bind(story).run();
    return json({ ok: true }, 201);
  }

  if (request.method === "GET" && url.pathname === "/api/comments") {
    const story = validStory(url.searchParams.get("story"));
    if (!story) return json({ error: "Invalid story" }, 400);
    const result = await env.DB.prepare(
      "SELECT id, name, message, created_at FROM comments WHERE story = ? AND status = 'approved' ORDER BY created_at ASC LIMIT 100"
    ).bind(story).all();
    return json({ comments: result.results });
  }

  if (request.method === "POST" && url.pathname === "/api/comments") {
    if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
    const body = await readJson(request);
    if (body.website) return json({ ok: true, pending: true }, 202);
    const story = validStory(body.story);
    const name = cleanText(body.name, 60);
    const message = cleanText(body.message, 1000);
    if (!story || name.length < 2 || message.length < 2) return json({ error: "Please complete all fields" }, 400);
    await env.DB.prepare(
      "INSERT INTO comments (story, name, message, status, created_at) VALUES (?, ?, ?, 'pending', unixepoch())"
    ).bind(story, name, message).run();
    return json({ ok: true, pending: true }, 202);
  }

  if (url.pathname.startsWith("/api/admin/")) {
    if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401);

    if (request.method === "GET" && url.pathname === "/api/admin/dashboard") {
      const [views, comments] = await env.DB.batch([
        env.DB.prepare("SELECT story, views, updated_at FROM story_views ORDER BY views DESC, story ASC"),
        env.DB.prepare("SELECT id, story, name, message, status, created_at FROM comments ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 250")
      ]);
      return json({ views: views.results, comments: comments.results });
    }

    const match = url.pathname.match(/^\/api\/admin\/comments\/(\d+)$/);
    if (match && request.method === "PATCH") {
      const body = await readJson(request);
      if (!['approved', 'pending'].includes(body.status)) return json({ error: "Invalid status" }, 400);
      await env.DB.prepare("UPDATE comments SET status = ? WHERE id = ?").bind(body.status, Number(match[1])).run();
      return json({ ok: true });
    }
    if (match && request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(Number(match[1])).run();
      return json({ ok: true });
    }
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        await ensureSchema(env);
        return await handleApi(request, env, url);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: "request_error", path: url.pathname, message: String(error?.message || error) }));
      if (error?.message === "JSON_REQUIRED") return json({ error: "JSON required" }, 415);
      if (error?.message === "TOO_LARGE") return json({ error: "Request too large" }, 413);
      return json({ error: "Something went wrong" }, 500);
    }
  }
};
