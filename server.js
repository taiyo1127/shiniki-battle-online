const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const index = fs.readFileSync(path.join(__dirname, "index.html"));

const httpServer = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
    res.end(index);
    return;
  }
  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocket.Server({ server: httpServer });
const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function broadcast(room, data) {
  room.players.forEach(p => send(p, data));
}

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      const code = String(msg.room || "").trim().toUpperCase();
      if (!code) return send(ws, {type:"error", message:"ルームコードを入力してください"});
      let room = rooms.get(code);
      if (!room) {
        room = { players: [], state: null };
        rooms.set(code, room);
      }
      if (room.players.length >= 2) {
        return send(ws, {type:"error", message:"この部屋は満員です"});
      }

      room.players.push(ws);
      ws.room = code;
      ws.playerIndex = room.players.length - 1;

      send(ws, {type:"joined", playerIndex: ws.playerIndex, count: room.players.length});
      broadcast(room, {type:"players", count: room.players.length});

      if (room.players.length === 2) {
        room.state = {
          hp: [100, 100],
          mp: [5, 5],
          turn: 0,
          log: ["対戦開始！"],
          winner: null
        };
        broadcast(room, {type:"state", state: room.state});
      }
      return;
    }

    if (!ws.room) return;
    const room = rooms.get(ws.room);
    if (!room) return;

    if (msg.type === "action" && room.players.length === 2 && room.state && room.state.winner === null) {
      const s = room.state;
      const p = ws.playerIndex;
      if (s.turn !== p) return;

      const action = msg.action;
      const enemy = 1 - p;
      let text = "";

      if (action === "attack") {
        const dmg = 12;
        s.hp[enemy] = Math.max(0, s.hp[enemy] - dmg);
        text = `プレイヤー${p+1}の攻撃！ ${dmg}ダメージ`;
      } else if (action === "magic") {
        if (s.mp[p] < 2) return send(ws, {type:"error", message:"MPが足りません"});
        s.mp[p] -= 2;
        const dmg = 22;
        s.hp[enemy] = Math.max(0, s.hp[enemy] - dmg);
        text = `プレイヤー${p+1}の魔法！ ${dmg}ダメージ`;
      } else if (action === "heal") {
        if (s.mp[p] < 2) return send(ws, {type:"error", message:"MPが足りません"});
        s.mp[p] -= 2;
        s.hp[p] = Math.min(100, s.hp[p] + 18);
        text = `プレイヤー${p+1}の回復！ HP+18`;
      } else {
        return;
      }

      s.log.push(text);
      if (s.hp[enemy] <= 0) {
        s.winner = p;
        s.log.push(`プレイヤー${p+1}の勝利！`);
      } else {
        s.turn = enemy;
      }
      broadcast(room, {type:"state", state:s});
    }
  });

  ws.on("close", () => {
    const code = ws.room;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p !== ws);
    if (room.players.length === 0) rooms.delete(code);
    else broadcast(room, {type:"players", count: room.players.length});
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
