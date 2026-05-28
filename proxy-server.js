import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const content = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    const vars = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      vars[key] = val;
    }
    return vars;
  } catch {
    return {};
  }
}

const env = loadEnv();
const API_URL = env.API_AWS_CLIENTES;

if (!API_URL) {
  console.error("Erro: API_AWS_CLIENTES não encontrada no arquivo .env");
  process.exit(1);
}

const target = new URL(API_URL);
const PORT = 3000;

const server = http.createServer((req, res) => {
  // Serve o HTML
  if (req.method === "GET" && req.url === "/") {
    try {
      const html = fs.readFileSync(path.join(__dirname, "frontend", "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end("Erro interno ao carregar o HTML.");
    }
    return;
  }

  // Proxy POST /api/clientes → AWS API Gateway
  if (req.method === "POST" && req.url === "/api/clientes") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const options = {
        hostname: target.hostname,
        path: target.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      };

      const proxyReq = https.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json" });
        proxyRes.pipe(res);
      });

      proxyReq.on("error", () => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: "Falha ao contatar a API." }));
      });

      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`✓ Servidor rodando em http://localhost:${PORT}`);
  console.log(`  Proxy ativo → ${target.hostname}`);
});
