/* Ретранслятор комнат для игры «Огневой рубеж» на Cloudflare Workers + Durable Objects.
   Каждая комната (по коду) — отдельный Durable Object, все игроки комнаты подключены к нему. */

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

export class Room {
  constructor(state, env) {
    this.rooms = new Map();
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const u = new URL(request.url);
    const code = (u.searchParams.get("room") || "").toUpperCase();
    const id = u.searchParams.get("id") || "";
    const role = u.searchParams.get("role") || "join";
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const sock = {
      get readyState() { return server.readyState; },
      send: (s) => server.send(s),
      close: () => { try { server.close(); } catch (_) {} },
      onmessage: null,
      onclose: null,
    };
    server.addEventListener("message", (e) => { if (sock.onmessage) sock.onmessage({ data: typeof e.data === "string" ? e.data : "" }); });
    server.addEventListener("close", () => { if (sock.onclose) sock.onclose(); });
    server.addEventListener("error", () => { if (sock.onclose) sock.onclose(); });
    attachSocket(this.rooms, sock, code, id, role);
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Ognevoy rubezh relay: ok", { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain; charset=utf-8" } });
    }
    const code = (new URL(request.url).searchParams.get("room") || "").toUpperCase();
    if (!code || code.length > 8) return new Response("bad room", { status: 400 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(request);
  },
};
