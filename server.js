/* Ретранслятор комнат для игры «Огневой рубеж». Node.js + ws. Запускается командой: npm start */
const http = require("http");
const { WebSocketServer } = require("ws");

/* Ядро ретранслятора комнат. Подключается и в Deno-сервер, и в тест. */
function attachSocket(rooms, ws, code, id, role) {
  const send = (s, o) => { try { if (s.readyState === 1) s.send(JSON.stringify(o)); } catch (_) {} };
  if (!code || !id || code.length > 8 || id.length > 24) { send(ws, { srv: "err", err: "bad" }); try { ws.close(); } catch (_) {} return; }
  let room = rooms.get(code);
  if (role === "host") {
    if (room) { send(ws, { srv: "err", err: "taken" }); try { ws.close(); } catch (_) {} return; }
    room = { host: id, peers: new Map() };
    rooms.set(code, room);
  } else {
    if (!room) { send(ws, { srv: "err", err: "notfound" }); try { ws.close(); } catch (_) {} return; }
    if (room.peers.size >= 8) { send(ws, { srv: "err", err: "full" }); try { ws.close(); } catch (_) {} return; }
  }
  room.peers.set(id, ws);
  send(ws, { srv: "ok", host: room.host });
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      const t = room.peers.get(m.p);
      if (t && t.readyState === 1) t.send(JSON.stringify(m.m));
    } catch (_) {}
  };
  ws.onclose = () => {
    if (room.peers.get(id) !== ws) return;
    room.peers.delete(id);
    if (id === room.host) {
      room.peers.forEach((s) => { send(s, { srv: "gone", id }); try { s.close(); } catch (_) {} });
      rooms.delete(code);
    } else {
      const h = room.peers.get(room.host);
      if (h) send(h, { srv: "gone", id });
    }
  };
}

const rooms = new Map();
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end("Ognevoy rubezh relay: ok, rooms=" + rooms.size);
});
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const u = new URL(req.url, "http://x");
  const code = (u.searchParams.get("room") || "").toUpperCase();
  const id = u.searchParams.get("id") || "";
  const role = u.searchParams.get("role") || "join";
  const sock = {
    get readyState() { return ws.readyState; },
    send: (s) => ws.send(s),
    close: () => { try { ws.close(); } catch (_) {} },
    onmessage: null,
    onclose: null,
  };
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", (d) => { ws.isAlive = true; if (sock.onmessage) sock.onmessage({ data: d.toString() }); });
  ws.on("close", () => { if (sock.onclose) sock.onclose(); });
  ws.on("error", () => {});
  attachSocket(rooms, sock, code, id, role);
});

/* отсекаем «мёртвые» соединения, чтобы комнаты не зависали */
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { try { ws.terminate(); } catch (_) {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
}, 20000);

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("relay listening on " + PORT));
