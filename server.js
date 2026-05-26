const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = __dirname;
const START_PORT = Number.parseInt(process.env.PORT || "5173", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "execpanel-v4.json");
const LEGACY_DATA_FILES = [path.join(DATA_DIR, "execpanel-v3.json"), path.join(DATA_DIR, "execpanel-v1.json")];

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
      if (e.code === "ENOENT") {
        for (const legacyFile of LEGACY_DATA_FILES) {
          try {
            const text = await fs.promises.readFile(legacyFile, "utf8");
            res.writeHead(200, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(text);
            return;
          } catch {}
        }
        return sendJson(res, 200, null);
      }
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
  const rootRelative = path.relative(ROOT, file);
  const dataRelative = path.relative(DATA_DIR, file);
  const outsideRoot = rootRelative.startsWith("..") || path.isAbsolute(rootRelative);
  const insideDataDir = dataRelative === "" || (!dataRelative.startsWith("..") && !path.isAbsolute(dataRelative));

  if (outsideRoot || insideDataDir) {
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

function createAppServer() {
  return http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, mode: "shared", dataFile: DATA_FILE });
    return;
  }
  if (url.pathname === "/api/data") {
    handleDataApi(req, res);
    return;
  }
  serveStatic(req, res);
  });
}

function getLanAddresses() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, infos]) =>
      (infos || [])
        .filter((info) => info && info.family === "IPv4" && !info.internal)
        .map((info) => ({
          name,
          address: info.address,
          virtual: /vEthernet|VMware|VirtualBox|Loopback|WSL|Docker/i.test(name),
        }))
    )
    .sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

function listen(port, attemptsLeft = 10) {
  const server = createAppServer();

  server.once("error", (err) => {
    if ((err.code === "EADDRINUSE" || err.code === "EACCES") && attemptsLeft > 0) {
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error("Failed to start shared server:", err.message);
    process.exitCode = 1;
  });

  server.listen(port, HOST, () => {
    const lan = getLanAddresses();
    console.log(`Execution Panel shared server: http://localhost:${port}/`);
    if (lan.length) {
      console.log("Open one of these URLs on your phone. Prefer Wi-Fi/LAN, avoid virtual adapters:");
      for (const item of lan) {
        const note = item.virtual ? " (virtual adapter, usually not for phone)" : ` (${item.name})`;
        console.log(`  http://${item.address}:${port}/${note}`);
      }
    } else {
      console.log(`Use your LAN IP on other devices, for example: http://192.168.x.x:${port}/`);
    }
    console.log(`Health check: http://localhost:${port}/api/health`);
    console.log("On your phone, open the same LAN URL with /api/health first. It should show {\"ok\":true}.");
  });
}

listen(START_PORT);
