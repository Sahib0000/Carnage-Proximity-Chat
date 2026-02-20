const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGIN = "https://voice.carnagepvp.net";

const io = new Server(server, {
    cors: { origin: ALLOWED_ORIGIN },
    maxHttpBufferSize: 1e8
});

const codeToUsername = {};
const players = {};

function buildPresenceList() {
    return Object.entries(players).map(([id, p]) => ({ id, username: p.username }));
}

function broadcastPresence(targetSocket) {
    const payload = { list: buildPresenceList() };
    if (targetSocket) {
        try { targetSocket.emit("presence", payload); } catch (_) {}
    } else {
        try { io.emit("presence", payload); } catch (_) {}
    }
}

app.use(express.static(path.join(__dirname, "build")));
app.use(express.json());


function generateTurnCredentials(identity = "voice") {
    const ttl = parseInt(process.env.TURN_DEFAULT_TTL || "3600", 10);
    const unixTime = Math.floor(Date.now() / 1000) + ttl;
    const username = `${unixTime}:${identity}`;

    const hmac = crypto.createHmac("sha1", process.env.TURN_SHARED_SECRET);
    hmac.update(username);
    const password = hmac.digest("base64");

    return { username, password, ttl };
}

app.get("/ice-config", (req, res) => {
    try {
        const { username, password } = generateTurnCredentials("voice");

        const host = process.env.TURN_HOST;
        const port = process.env.TURN_PORT || 3478;
        const tlsPort = process.env.TURN_TLS_PORT || 5349;

        const iceServers = [
            { urls: "stun:stun.l.google.com:19302" },
            {
                urls: [
                    `turn:${host}:${port}?transport=udp`,
                    `turn:${host}:${port}?transport=tcp`,
                    `turns:${host}:${tlsPort}?transport=tcp`,
                ],
                username,
                credential: password,
            },
        ];

        res.json({ iceServers });
    } catch (err) {
        console.error("Failed to build ICE config:", err);
        res.status(500).json({ iceServers: [] });
    }
});

app.post("/register", (req, res) => {
    const { username, code } = req.body;
    if (!username || !code) return res.sendStatus(400);

    codeToUsername[code] = { username, ts: Date.now() };
    console.log(`Registered ${username} with code ${code}`);
    res.sendStatus(200);
});

app.post("/position", (req, res) => {
    const code = req.headers["x-voice-code"];
    if (!code) return res.sendStatus(401);

    const entry = codeToUsername[code];
    const username = entry?.username;
    if (!username) return res.sendStatus(401);

    const { x, y, z, world } = req.body;

    for (const id in players) {
        if (players[id].username === username) {
            players[id].x = x;
            players[id].y = y;
            players[id].z = z;
            players[id].world = world || "world";
            io.emit("update-position", { id, pos: players[id], username });
            return res.sendStatus(200);
        }
    }
    res.sendStatus(404);
});

app.post("/disconnect", (req, res) => {
    const code = req.headers["x-voice-code"];
    if (!code) return res.sendStatus(401);

    const entry = codeToUsername[code];
    const username = entry?.username;
    if (!username) return res.sendStatus(401);

    for (const id in players) {
        if (players[id].username === username) {
            io.to(id).disconnectSockets(true);
            delete players[id];
            break;
        }
    }

    delete codeToUsername[code];
    console.log(`Disconnected ${username} and removed code ${code}`);
    res.sendStatus(200);
});

app.get("/active", (req, res) => {
    res.json({ active: buildPresenceList() });
});

app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, "build", "index.html"));
});


io.on("connection", (socket) => {
    const code = socket.handshake.query.code;
    if (!code) return socket.disconnect(true);

    const entry = codeToUsername[code];
    const username = entry?.username;
    if (!username) return socket.disconnect(true);

    const TTL_MS = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    if (!entry.ts || now - entry.ts > TTL_MS) {
        try { socket.emit("already-connected"); } catch (_) {}
        setTimeout(() => { try { socket.disconnect(true); } catch (_) {} }, 10);
        return;
    }

    const alreadyOnlineId = Object.keys(players).find(
        id => players[id]?.username === username
    );
    if (alreadyOnlineId) {
        try { socket.emit("already-connected"); } catch (_) {}
        setTimeout(() => { try { socket.disconnect(true); } catch (_) {} }, 10);
        return;
    }

    console.log(`${username} connected to voice`);
    players[socket.id] = { username, x: 0, y: 64, z: 0, world: "world" };

    for (const id in players) {
        if (id !== socket.id) {
            socket.emit("new-peer", { id, initiator: true });
            io.to(id).emit("new-peer", { id: socket.id, initiator: false });
        }
    }

    try {
        for (const id in players) {
            socket.emit("update-position", { id, pos: players[id], username: players[id].username });
        }
        socket.broadcast.emit("update-position", { id: socket.id, pos: players[socket.id], username });
    } catch (_) {}

    const rate = { lastSignalAt: 0, lastPosAt: 0 };

    try { socket.emit("connection-accepted"); } catch (_) {}
    broadcastPresence(socket);
    broadcastPresence();

    socket.on("signal", (data) => {
        const nowTs = Date.now();
        if (nowTs - rate.lastSignalAt < 20) return;
        rate.lastSignalAt = nowTs;
        if (!data || typeof data.targetId !== "string" || !data.signal) return;
        io.to(data.targetId).emit("signal", { from: socket.id, signal: data.signal });
    });

    socket.on("position", (pos) => {
        const nowTs = Date.now();
        if (nowTs - rate.lastPosAt < 100) return;
        rate.lastPosAt = nowTs;
        if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number" || typeof pos.z !== "number") return;
        const world = typeof pos.world === "string" && pos.world ? pos.world : players[socket.id].world;
        Object.assign(players[socket.id], { x: pos.x, y: pos.y, z: pos.z, world });
        io.emit("update-position", { id: socket.id, pos: players[socket.id], username });
    });

    socket.on("disconnect", () => {
        console.log(`${players[socket.id]?.username || "Unknown"} disconnected`);
        socket.broadcast.emit("remove-peer", socket.id);
        delete players[socket.id];
        broadcastPresence();
    });
});

server.listen(3000, "0.0.0.0", () => {
    console.log(`Voice server running → https://voice.carnagepvp.net (port 3000)`);
});
