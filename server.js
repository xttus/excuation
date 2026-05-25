const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number.parseInt(process.env.PORT || "5173", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "execpanel-v3.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleDataApi(req, res) {
  if (req.method === "GET") {
    try {
      const text = await fs.promises.readFile(DATA_FILE, "utf8");
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(text);
    } catch (e) {
      if (e.code === "ENOENT") return sendJson(res, 200, null);
      return sendJson(res, 500, { error: "read_failed" });
    }
    return;
  }

  if (req.method === "PUT") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || "{}");
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      await fs.promises.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
      sendJson(res, 200, { ok: true, updatedAt: data.updatedAt || "" });
    } catch {
      sendJson(res, 400, { error: "write_failed" });
    }
    return;
  }

  sendJson(res, 405, { error: "method_not_allowed" });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT) || file.startsWith(DATA_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/data") {
    handleDataApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Execution Panel shared server: http://localhost:${PORT}/`);
  console.log("Use your LAN IP on other devices, for example: http://192.168.x.x:5173/");
});
