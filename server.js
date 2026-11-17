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
Deno.serve((req) => {
  if (req.headers.get("upgrade") !== "websocket") return new Response("Ognevoy rubezh relay: ok");
  const u = new URL(req.url);
  const code = (u.searchParams.get("room") || "").toUpperCase();
  const id = u.searchParams.get("id") || "";
  const role = u.searchParams.get("role") || "join";
  const { socket, response } = Deno.upgradeWebSocket(req);
  socket.onopen = () => attachSocket(rooms, socket, code, id, role);
  return response;
});
