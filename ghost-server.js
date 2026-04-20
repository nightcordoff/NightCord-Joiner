/**
 * ghost-server.js — Serveur HTTP local pour GhostClient Equicord
 * discord.js-selfbot-v13 — API correcte : connection.playAudio(stream, { type: "converted" })
 * Port : 47821
 */

"use strict";

const http      = require("http");
const { spawn } = require("child_process");
const path      = require("path");
const fs        = require("fs");
const { Client } = require("discord.js-selfbot-v13");

const PORT = 47821;

// userId → { client, ffmpegProc, dispatcher, connection }
const clients = new Map();

// ── ffmpeg ────────────────────────────────────────────────────────────────────
function findFfmpeg() {
    const candidates = [
        "ffmpeg",
        "C:\\ffmpeg\\bin\\ffmpeg.exe",
        "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
        path.join(process.env.LOCALAPPDATA || "", "Programs", "ffmpeg", "bin", "ffmpeg.exe"),
    ];
    for (const c of candidates) {
        try { if (fs.existsSync(c)) return c; } catch {}
    }
    return "ffmpeg";
}

// ── Liste devices audio dshow ─────────────────────────────────────────────────
let deviceCache = null;
function listDshowDevices() {
    if (deviceCache) return Promise.resolve(deviceCache);
    return new Promise(resolve => {
        const ffmpeg = findFfmpeg();
        const p = spawn(ffmpeg, ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
            windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        p.stderr?.on("data", d => out += d.toString());
        p.stdout?.on("data", d => out += d.toString());
        const done = () => {
            const devices = [];
            const re = /"([^"]+)"\s*\(audio\)/gi;
            let m;
            while ((m = re.exec(out)) !== null) devices.push(m[1]);
            if (devices.length === 0) {
                let inAudio = false;
                for (const line of out.split("\n")) {
                    if (line.toLowerCase().includes("audio")) inAudio = true;
                    if (inAudio) {
                        const match = line.match(/"([^"]+)"/);
                        if (match && !match[1].includes("\\") && match[1].length > 2)
                            devices.push(match[1]);
                    }
                }
            }
            const unique = [...new Set(devices)];
            console.log("[Ghost] Devices audio:", unique);
            deviceCache = unique;
            resolve(unique);
        };
        p.on("exit", done);
        p.on("error", () => resolve([]));
        setTimeout(() => { try { p.kill(); } catch {} done(); }, 5000);
    });
}

// ── Stream audio ffmpeg PCM → Discord via playAudio() ─────────────────────────
// La bonne API discord.js-selfbot-v13 :
//   connection.playAudio(readableStream, { type: "converted" })
//   "converted" = PCM 16-bit signed stéréo 48000Hz — exactement ce que ffmpeg sort avec -f s16le
function startAudioStream(userId, micDevice) {
    const entry = clients.get(userId);
    if (!entry?.connection) {
        console.log(`[Ghost] ${userId} : pas de connexion voice active`);
        return;
    }

    // Nettoyer ancien stream
    if (entry.dispatcher) {
        try { entry.dispatcher.destroy(); } catch {}
        entry.dispatcher = null;
    }
    if (entry.ffmpegProc) {
        try { entry.ffmpegProc.kill("SIGKILL"); } catch {}
        entry.ffmpegProc = null;
    }

    if (!micDevice || micDevice.trim() === "") {
        console.log(`[Ghost] ${userId} : aucun device micro fourni`);
        return;
    }

    const ffmpeg = findFfmpeg();

    // ffmpeg capture dshow audio → PCM 16-bit 48kHz stéréo sur stdout
    // -ar 48000 -ac 2 -f s16le pipe:1
    const args = [
        "-f", "dshow",
        "-i", `audio=${micDevice}`,
        "-ar", "48000",
        "-ac", "2",
        "-f", "s16le",
        "pipe:1",
    ];

    console.log(`[Ghost] ${userId} démarrage stream micro: "${micDevice}"`);

    const proc = spawn(ffmpeg, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stderr?.on("data", d => {
        const txt = d.toString();
        if (txt.includes("rror") || txt.includes("fail") || txt.includes("warn")) {
            process.stdout.write(`[ffmpeg/${userId}] ${txt.slice(0, 200)}\n`);
        }
    });

    proc.on("error", e => console.error(`[Ghost] ffmpeg spawn error: ${e.message}`));
    proc.on("exit", (code, sig) => {
        console.log(`[Ghost] ${userId} ffmpeg exit code=${code} signal=${sig}`);
        if (entry.ffmpegProc === proc) entry.ffmpegProc = null;
    });

    entry.ffmpegProc = proc;

    try {
        // API correcte : playAudio avec type "converted" (PCM brut 16bit stéréo 48kHz)
        const dispatcher = entry.connection.playAudio(proc.stdout, {
            type: "converted",
            bitrate: 128,
            volume: false,       // pas de transformation volume = plus léger
            highWaterMark: 12,
        });

        dispatcher.on("start", () => console.log(`[Ghost] ${userId} audio stream DÉMARRÉ`));
        dispatcher.on("finish", () => {
            console.log(`[Ghost] ${userId} audio stream terminé`);
            entry.dispatcher = null;
        });
        dispatcher.on("error", e => console.error(`[Ghost] dispatcher error: ${e.message}`));

        entry.dispatcher = dispatcher;
        console.log(`[Ghost] ${userId} playAudio() OK`);

    } catch (e) {
        console.error(`[Ghost] playAudio() ERREUR: ${e.message}`);
        // Tuer ffmpeg si play a échoué
        try { proc.kill("SIGKILL"); } catch {}
        entry.ffmpegProc = null;
    }
}

// ── Rejoindre vocal ───────────────────────────────────────────────────────────
async function joinVoice(userId, guildId, channelId, micDevice) {
    const entry = clients.get(userId);
    if (!entry) throw new Error("Client non connecté");

    // Nettoyer ancien vocal
    if (entry.dispatcher) { try { entry.dispatcher.destroy(); } catch {} entry.dispatcher = null; }
    if (entry.ffmpegProc) { try { entry.ffmpegProc.kill("SIGKILL"); } catch {} entry.ffmpegProc = null; }
    if (entry.connection) {
        try { entry.connection.disconnect(); } catch {}
        entry.connection = null;
        await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Ghost] ${userId} join canal ${channelId}...`);

    // Rejoindre via client.voice.joinChannel (retourne une VoiceConnection)
    const conn = await entry.client.voice.joinChannel(channelId, {
        selfMute: false,
        selfDeaf: false,
    });

    entry.connection = conn;
    console.log(`[Ghost] ${userId} VoiceConnection établie sur canal ${channelId}`);

    conn.on("disconnect", () => {
        console.log(`[Ghost] ${userId} déconnecté du vocal`);
        if (entry.dispatcher) { try { entry.dispatcher.destroy(); } catch {} entry.dispatcher = null; }
        if (entry.ffmpegProc) { try { entry.ffmpegProc.kill("SIGKILL"); } catch {} entry.ffmpegProc = null; }
        entry.connection = null;
    });

    conn.on("error", e => console.error(`[Ghost] conn error: ${e.message}`));

    // Attendre 2s pour stabilisation de la connexion UDP avant de streamer
    if (micDevice && micDevice.trim() !== "") {
        setTimeout(() => startAudioStream(userId, micDevice), 2000);
    }
}

// ── Quitter vocal ─────────────────────────────────────────────────────────────
async function leaveVoice(userId) {
    const entry = clients.get(userId);
    if (!entry) return;
    if (entry.dispatcher) { try { entry.dispatcher.destroy(); } catch {} entry.dispatcher = null; }
    if (entry.ffmpegProc) { try { entry.ffmpegProc.kill("SIGKILL"); } catch {} entry.ffmpegProc = null; }
    if (entry.connection) {
        try { entry.connection.disconnect(); } catch {}
        entry.connection = null;
    }
}

// ── Connecter client ──────────────────────────────────────────────────────────
async function connectClient(userId, token, guildId, channelId, micDevice) {
    if (clients.has(userId)) await disconnectClient(userId);

    return new Promise(resolve => {
        const client = new Client({
            checkUpdate: false,
            readyStatus: false,
            patchVoice: true,
        });

        const entry = { client, ffmpegProc: null, connection: null, dispatcher: null };
        clients.set(userId, entry);

        const timeout = setTimeout(() => {
            console.error(`[Ghost] ${userId} timeout connexion`);
            resolve({ ok: false, error: "Timeout connexion (25s)" });
        }, 25000);

        client.once("ready", async () => {
            console.log(`[Ghost] ${client.user?.tag} connecté (${userId})`);
            clearTimeout(timeout);

            if (channelId) {
                try {
                    await joinVoice(userId, guildId, channelId, micDevice);
                } catch (e) {
                    console.error(`[Ghost] joinVoice error: ${e.message}`);
                }
            }

            resolve({ ok: true });
        });

        client.on("error", e => console.error(`[Ghost] client error: ${e.message}`));

        client.login(token).catch(e => {
            clearTimeout(timeout);
            clients.delete(userId);
            resolve({ ok: false, error: `Login échoué: ${e.message}` });
        });
    });
}

// ── Déconnecter client ────────────────────────────────────────────────────────
async function disconnectClient(userId) {
    await leaveVoice(userId);
    const entry = clients.get(userId);
    if (entry?.client) { try { entry.client.destroy(); } catch {} }
    clients.delete(userId);
    console.log(`[Ghost] ${userId} déconnecté complètement`);
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
function readBody(req) {
    return new Promise(resolve => {
        let data = "";
        req.on("data", c => data += c);
        req.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
}

function send(res, obj, code = 200) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
}

http.createServer(async (req, res) => {
    const url = req.url?.split("?")[0] ?? "/";
    try {
        if (req.method === "GET"  && url === "/status")  return send(res, { ok: true, clients: clients.size });
        if (req.method === "GET"  && url === "/devices") return send(res, { ok: true, devices: await listDshowDevices() });

        if (req.method === "POST" && url === "/connect") {
            const { userId, token, guildId, channelId, micDevice } = await readBody(req);
            if (!userId || !token) return send(res, { ok: false, error: "userId et token requis" }, 400);
            return send(res, await connectClient(userId, token, guildId || "", channelId || "", micDevice || ""));
        }

        if (req.method === "POST" && url === "/join") {
            const { userId, guildId, channelId, micDevice } = await readBody(req);
            if (!userId) return send(res, { ok: false, error: "userId requis" }, 400);
            try {
                await joinVoice(userId, guildId, channelId, micDevice || "");
                return send(res, { ok: true });
            } catch (e) { return send(res, { ok: false, error: e.message }); }
        }

        if (req.method === "POST" && url === "/leave") {
            const { userId } = await readBody(req);
            await leaveVoice(userId);
            return send(res, { ok: true });
        }

        if (req.method === "POST" && url === "/disconnect") {
            const { userId } = await readBody(req);
            await disconnectClient(userId);
            return send(res, { ok: true });
        }

        send(res, { ok: false, error: "Route inconnue" }, 404);
    } catch (e) {
        console.error("[Server] erreur:", e.message);
        send(res, { ok: false, error: e.message }, 500);
    }
}).listen(PORT, "127.0.0.1", () => {
    console.log(`[Ghost Server] Démarrage depuis Joiner (modules deja installes)...`);
    console.log(`[Ghost Server] Laisse cette fenetre ouverte en arriere-plan`);
    console.log(`[Ghost Server] Prêt sur http://127.0.0.1:${PORT} — Node ${process.version}`);
});

process.on("uncaughtException",  e => console.error("[Ghost] uncaughtException:", e.message));
process.on("unhandledRejection", e => console.error("[Ghost] unhandledRejection:", e));
