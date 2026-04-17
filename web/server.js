const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = __dirname;
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function safePathFromUrl(urlPathname) {
  const decoded = decodeURIComponent(urlPathname.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^([.][.][/\\])+/, "");
  return path.join(root, normalized);
}

function sendFile(filePath, response) {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Internal Server Error");
    });
    stream.pipe(response);
  });
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  let targetPath = safePathFromUrl(requestUrl.pathname);

  if (requestUrl.pathname === "/") {
    targetPath = path.join(root, "index.html");
  }

  if (!targetPath.startsWith(root)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  sendFile(targetPath, response);
});

server.listen(port, host, () => {
  const interfaces = os.networkInterfaces();
  const urls = [`http://localhost:${port}`];

  Object.values(interfaces).forEach((ifaceList) => {
    if (!ifaceList) {
      return;
    }
    ifaceList.forEach((iface) => {
      if (iface.family === "IPv4" && !iface.internal) {
        urls.push(`http://${iface.address}:${port}`);
      }
    });
  });

  const uniqueUrls = Array.from(new Set(urls));
  console.log("Infiniband Web server is running.");
  uniqueUrls.forEach((url) => console.log(`  ${url}`));
  console.log("Press Ctrl+C to stop.");
});
