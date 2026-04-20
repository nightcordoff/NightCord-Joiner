const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let clients = new Map();
let loopIntervals = new Map();
let followIntervals = new Map();
let lastKnownChannel = new Map();
let proxies = [];
let captchaKey = '';

// Charger les proxies au démarrage (si fichier existe)
function loadProxiesFromFile() {
    try {
        const proxyFile = path.join(__dirname, 'proxies.txt');
        if (fs.existsSync(proxyFile)) {
            const content = fs.readFileSync(proxyFile, 'utf-8');
            proxies = content.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(line => {
                    const [host, port, username, password] = line.split(':');
                    return { host, port, username, password };
                });
            console.log(`✅ ${proxies.length} proxies chargés depuis fichier`);
        }
    } catch (err) {
        console.log('[⚠️ PROXIES] Aucun fichier proxies.txt trouvé');
    }
}

// Charger la clé 2captcha (si fichier existe)
function loadCaptchaFromFile() {
    try {
        const keyFile = path.join(__dirname, '2capcha.txt');
        if (fs.existsSync(keyFile)) {
            captchaKey = fs.readFileSync(keyFile, 'utf-8').trim();
            console.log('✅ Clé 2Captcha chargée depuis fichier');
        }
    } catch (err) {
        console.log('[⚠️ 2CAPTCHA] Aucun fichier 2capcha.txt trouvé');
    }
}

// Charger les proxies depuis le client
function loadProxiesFromClient(proxyList) {
    proxies = proxyList.map(line => {
        const [host, port, username, password] = line.split(':');
        return { host, port, username, password };
    });
    console.log(`✅ ${proxies.length} proxies chargés depuis le client`);
}

// Charger la clé captcha depuis le client
function loadCaptchaFromClient(key) {
    captchaKey = key;
    console.log('✅ Clé 2Captcha chargée depuis le client');
}

// Résoudre le hcaptcha avec 2captcha
async function solve2Captcha(sitekey, pageurl) {
    if (!captchaKey) {
        throw new Error('Clé 2Captcha non configurée');
    }

    try {
        // Créer la tâche
        const createTask = await axios.get('https://2captcha.com/in.php', {
            params: {
                key: captchaKey,
                method: 'hcaptcha',
                sitekey: sitekey,
                pageurl: pageurl,
                json: 1
            }
        });

        if (createTask.data.status !== 1) {
            throw new Error('Erreur création tâche captcha');
        }

        const taskId = createTask.data.request;

        // Attendre la résolution (max 120s)
        for (let i = 0; i < 40; i++) {
            await new Promise(resolve => setTimeout(resolve, 3000));

            const result = await axios.get('https://2captcha.com/res.php', {
                params: {
                    key: captchaKey,
                    action: 'get',
                    id: taskId,
                    json: 1
                }
            });

            if (result.data.status === 1) {
                return result.data.request;
            }
        }

        throw new Error('Timeout captcha');
    } catch (err) {
        throw new Error(`2Captcha: ${err.message}`);
    }
}

// Obtenir un proxy pour un index
function getProxy(index) {
    if (proxies.length === 0) return null;
    const proxy = proxies[index % proxies.length];
    return `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
}

// Charger au démarrage si les fichiers existent
loadProxiesFromFile();
loadCaptchaFromFile();

process.on('uncaughtException', (err) => {
    if (err.message.includes('WebSocket was closed')) {
        console.log('[ERREUR WebSocket ignorée]', err.message);
    } else {
        console.error('[ERREUR NON GÉRÉE]', err);
    }
});

io.on('connection', (socket) => {
    console.log('✅ Client connecté:', socket.id);
    
    // Recevoir les proxies depuis le client
    socket.on('load-proxies', (proxyList) => {
        loadProxiesFromClient(proxyList);
        socket.emit('proxies-loaded', { count: proxies.length });
    });

    // Recevoir la clé captcha depuis le client
    socket.on('load-captcha', (key) => {
        loadCaptchaFromClient(key);
        socket.emit('captcha-loaded');
    });
    
    socket.on('connect-tokens', async (tokens) => {
        console.log(`🔄 Connexion RAPIDE de ${tokens.length} tokens...\n`);
        
        let successCount = 0;
        
        const connectionPromises = tokens.map(async (cleanToken) => {
            cleanToken = cleanToken.trim();
            
            if (clients.has(cleanToken)) {
                successCount++;
                return;
            }

            try {
                const client = new Client({ checkUpdate: false });

                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Timeout'));
                    }, 8000);

                    client.on('ready', () => {
                        clearTimeout(timeout);
                        clients.set(cleanToken, client);
                        successCount++;
                        
                        console.log(`[✅ ${successCount}] ${client.user.username}`);
                        
                        socket.emit('token-success', {
                            username: client.user.username
                        });
                        
                        resolve();
                    });

                    client.on('error', (err) => {
                        clearTimeout(timeout);
                        reject(err);
                    });

                    client.login(cleanToken).catch(reject);
                });

            } catch (err) {
                // Ignorer silencieusement
            }
        });
        
        await Promise.allSettled(connectionPromises);
        
        console.log(`\n📊 Total: ${successCount} comptes connectés en parallèle\n`);
        
        socket.emit('connection-complete', {
            success: successCount
        });
        
        const activeAccounts = Array.from(clients.values()).map(c => ({
            username: c.user.username,
            id: c.user.id
        }));
        io.emit('account-update', activeAccounts);
    });

    socket.on('join-vocal', async (data) => {
        const { guildId, channelId, options, delay, limit } = data;
        const joinDelay = delay || 50;
        const accountLimit = limit || 0;
        
        const clientsArray = Array.from(clients.entries());
        const clientsToJoin = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;
        
        console.log(`🎤 Rejoindre le canal ${channelId} avec ${clientsToJoin.length} comptes (délai: ${joinDelay}ms)${options.stream ? ' + STREAM' : ''}`);
        
        let joinCount = 0;
        const totalClients = clientsToJoin.length;
        
        const joinPromises = clientsToJoin.map(async ([token, client], index) => {
            await new Promise(resolve => setTimeout(resolve, index * joinDelay));
            
            try {
                const connection = await client.voice.joinChannel(channelId, {
                    selfMute: options.mute,
                    selfDeaf: options.deaf,
                    selfVideo: options.video,
                });
                
                if (options.stream && connection) {
                    try {
                        await connection.setVideoStatus(true);
                        console.log(`[🖥️ STREAM] ${client.user.username} - Stream activé`);
                    } catch (streamErr) {
                        console.log(`[⚠️ STREAM] ${client.user.username} - Erreur stream: ${streamErr.message}`);
                    }
                }
                
                joinCount++;
                console.log(`[🎤 ${joinCount}/${totalClients}] ${client.user.username} rejoint`);
            } catch (err) {
                console.log(`[❌ JOIN] ${client.user.username} - ${err.message}`);
            }
        });
        
        await Promise.all(joinPromises);
        
        console.log(`\n✅ ${joinCount}/${totalClients} comptes ont rejoint le vocal\n`);
    });

    socket.on('leave-vocal', async () => {
        console.log('🚪 Quitter la vocale EN PARALLÈLE...');
        
        let leaveCount = 0;
        
        const leavePromises = Array.from(clients.values()).map(async (client) => {
            try {
                if (client.voice?.connection) {
                    await client.voice.connection.disconnect();
                    leaveCount++;
                    console.log(`[🚪 ${leaveCount}] ${client.user.username} a quitté`);
                }
            } catch (err) {
                console.log(`[❌ LEAVE] ${client.user.username} - ${err.message}`);
            }
        });
        
        await Promise.allSettled(leavePromises);
        
        console.log(`\n✅ ${leaveCount} comptes ont quitté le vocal\n`);
    });

    socket.on('disconnect-all', () => {
        console.log('🔌 Déconnexion de tous les clients...');
        
        if (loopIntervals.has(socket.id)) {
            clearInterval(loopIntervals.get(socket.id));
            loopIntervals.delete(socket.id);
        }

        if (followIntervals.has(socket.id)) {
            clearInterval(followIntervals.get(socket.id));
            followIntervals.delete(socket.id);
        }

        clients.forEach(c => c.destroy());
        clients.clear();
        lastKnownChannel.clear();
        io.emit('account-update', []);
        console.log('[✅ DISCONNECT ALL] Tous les clients déconnectés.');
    });

    socket.on('start-loop', async (data) => {
        const { guildId, channelId, options, delay, limit } = data;
        const joinDelay = delay || 20;
        const accountLimit = limit || 0;
        
        if (loopIntervals.has(socket.id)) {
            clearInterval(loopIntervals.get(socket.id));
        }

        console.log(`[🔄 LOOP] Mode boucle ULTRA RAPIDE activé (délai: ${joinDelay}ms, limite: ${accountLimit || 'tous'})${options.stream ? ' + STREAM' : ''}`);
        
        let isJoining = true;

        const loopInterval = setInterval(async () => {
            const clientsArray = Array.from(clients.values());
            const clientsToJoin = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;
            
            if (isJoining) {
                console.log(`[🔄 JOIN] >>> ${clientsToJoin.length} comptes rejoignent...`);
                const joinPromises = clientsToJoin.map(async (client, index) => {
                    await new Promise(resolve => setTimeout(resolve, index * joinDelay));
                    try {
                        const connection = await client.voice.joinChannel(channelId, {
                            selfMute: options.mute,
                            selfDeaf: options.deaf,
                            selfVideo: options.video,
                        });
                        
                        if (options.stream && connection) {
                            try {
                                await connection.setVideoStatus(true);
                            } catch (streamErr) {}
                        }
                    } catch (err) {}
                });
                await Promise.all(joinPromises);
                console.log(`[✅] Tous en vocal`);
            } else {
                console.log(`[🔄 LEAVE] <<< ${clientsToJoin.length} comptes quittent...`);
                const leavePromises = clientsToJoin.map(async (client) => {
                    try {
                        if (client.voice?.connection) {
                            await client.voice.connection.disconnect();
                        }
                    } catch (err) {}
                });
                await Promise.all(leavePromises);
                console.log(`[✅] Tous hors vocal`);
            }
            
            isJoining = !isJoining;
        }, 800);

        loopIntervals.set(socket.id, loopInterval);
    });

    socket.on('stop-loop', async () => {
        if (loopIntervals.has(socket.id)) {
            clearInterval(loopIntervals.get(socket.id));
            loopIntervals.delete(socket.id);
            console.log('[🔄 LOOP] Mode boucle désactivé');
            
            const leavePromises = Array.from(clients.values()).map(async (client) => {
                try {
                    if (client.voice?.connection) {
                        await client.voice.connection.disconnect();
                    }
                } catch (err) {
                    console.log(`[STOP LOOP ERREUR] ${client.user.username} - ${err.message}`);
                }
            });
            await Promise.allSettled(leavePromises);
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Client déconnecté:', socket.id);
        if (loopIntervals.has(socket.id)) {
            clearInterval(loopIntervals.get(socket.id));
            loopIntervals.delete(socket.id);
        }
        if (followIntervals.has(socket.id)) {
            clearInterval(followIntervals.get(socket.id));
            followIntervals.delete(socket.id);
        }
    });

    socket.on('start-follow', async (data) => {
        const { userId, guildId, delay, limit, options } = data;
        const joinDelay = delay || 50;
        const accountLimit = limit || 0;
        
        if (followIntervals.has(socket.id)) {
            clearInterval(followIntervals.get(socket.id));
        }

        console.log(`[🎯 FOLLOW] Suivi activé pour l'utilisateur ${userId}${options.stream ? ' + STREAM' : ''}`);
        socket.emit('follow-update', { message: `Suivi activé pour ${userId}` });

        const followInterval = setInterval(async () => {
            try {
                const firstClient = Array.from(clients.values())[0];
                if (!firstClient) return;

                const guild = firstClient.guilds.cache.get(guildId);
                if (!guild) {
                    console.log('[❌ FOLLOW] Serveur introuvable');
                    return;
                }

                const target = guild.members.cache.get(userId);
                if (!target) {
                    console.log('[❌ FOLLOW] Utilisateur cible introuvable');
                    return;
                }

                const targetChannelId = target.voice?.channelId;
                
                if (!targetChannelId) {
                    if (lastKnownChannel.has(userId)) {
                        console.log(`[🎯 FOLLOW] Cible a quitté le vocal`);
                        socket.emit('follow-update', { message: 'Cible a quitté le vocal' });
                        lastKnownChannel.delete(userId);
                    }
                    return;
                }

                const lastChannel = lastKnownChannel.get(userId);
                if (lastChannel !== targetChannelId) {
                    console.log(`[🎯 FOLLOW] Cible détectée dans le canal ${targetChannelId}`);
                    lastKnownChannel.set(userId, targetChannelId);
                    socket.emit('follow-update', { message: `Suivi de la cible vers le canal ${targetChannelId}` });

                    const clientsArray = Array.from(clients.entries());
                    const clientsToFollow = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;

                    const followPromises = clientsToFollow.map(async ([token, client], index) => {
                        await new Promise(resolve => setTimeout(resolve, index * joinDelay));
                        
                        try {
                            const connection = await client.voice.joinChannel(targetChannelId, {
                                selfMute: options.mute,
                                selfDeaf: options.deaf,
                                selfVideo: options.video,
                            });
                            
                            if (options.stream && connection) {
                                try {
                                    await connection.setVideoStatus(true);
                                } catch (streamErr) {}
                            }
                            
                            console.log(`[🎯 FOLLOW] ${client.user.username} suit la cible`);
                        } catch (err) {
                            console.log(`[❌ FOLLOW] ${client.user.username} - ${err.message}`);
                        }
                    });

                    await Promise.all(followPromises);
                }
            } catch (err) {
                console.log(`[❌ FOLLOW ERROR] ${err.message}`);
            }
        }, 2000);

        followIntervals.set(socket.id, followInterval);
    });

    socket.on('stop-follow', () => {
        if (followIntervals.has(socket.id)) {
            clearInterval(followIntervals.get(socket.id));
            followIntervals.delete(socket.id);
            lastKnownChannel.clear();
            console.log('[🎯 FOLLOW] Suivi désactivé');
        }
    });

    socket.on('react-position', async (data) => {
        const { messageId, position, limit } = data;
        const accountLimit = limit || 0;
        const REACT_GUILD_ID = '1038108273703919746';
        
        console.log(`[❤️ REACT] React à la réaction ${position} sur le message ${messageId}`);
        
        const clientsArray = Array.from(clients.values());
        const clientsToReact = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;
        
        let reactCount = 0;
        const total = clientsToReact.length;
        
        const reactPromises = clientsToReact.map(async (client, index) => {
            await new Promise(resolve => setTimeout(resolve, index * 100));
            
            try {
                const guild = client.guilds.cache.get(REACT_GUILD_ID);
                if (!guild) {
                    console.log(`[❌ REACT] ${client.user.username} - Serveur introuvable`);
                    return;
                }
                
                let message = null;
                for (const channel of guild.channels.cache.values()) {
                    if (channel.isText()) {
                        try {
                            message = await channel.messages.fetch(messageId);
                            if (message) break;
                        } catch (err) {}
                    }
                }
                
                if (message) {
                    const reactions = Array.from(message.reactions.cache.values());
                    const targetReaction = reactions[position - 1];
                    
                    if (targetReaction) {
                        await message.react(targetReaction.emoji);
                        reactCount++;
                        console.log(`[❤️ ${reactCount}/${total}] ${client.user.username} a réagi`);
                    } else {
                        console.log(`[❌ REACT] ${client.user.username} - Réaction ${position} introuvable`);
                    }
                } else {
                    console.log(`[❌ REACT] ${client.user.username} - Message introuvable`);
                }
            } catch (err) {
                console.log(`[❌ REACT] ${client.user.username} - ${err.message}`);
            }
        });
        
        await Promise.all(reactPromises);
        
        console.log(`\n✅ ${reactCount}/${total} comptes ont réagi\n`);
        socket.emit('react-update', { message: `${reactCount}/${total} comptes ont réagi à la réaction ${position}` });
    });

    socket.on('remove-all-reactions', async (data) => {
        const { messageId, limit } = data;
        const accountLimit = limit || 0;
        const REACT_GUILD_ID = '1038108273703919746';
        
        console.log(`[🗑️ REMOVE] Suppression des réactions sur le message ${messageId}`);
        
        const clientsArray = Array.from(clients.values());
        const clientsToUnreact = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;
        
        let unreactCount = 0;
        const total = clientsToUnreact.length;
        
        const unreactPromises = clientsToUnreact.map(async (client, index) => {
            await new Promise(resolve => setTimeout(resolve, index * 80));
            
            try {
                const guild = client.guilds.cache.get(REACT_GUILD_ID);
                if (!guild) {
                    console.log(`[❌ REMOVE] ${client.user.username} - Serveur introuvable`);
                    return;
                }
                
                let message = null;
                for (const channel of guild.channels.cache.values()) {
                    if (channel.isText()) {
                        try {
                            message = await channel.messages.fetch(messageId);
                            if (message) break;
                        } catch (err) {}
                    }
                }
                
                if (message) {
                    for (const reaction of message.reactions.cache.values()) {
                        try {
                            await reaction.users.remove(client.user.id);
                        } catch (err) {}
                    }
                    unreactCount++;
                    console.log(`[🗑️ ${unreactCount}/${total}] ${client.user.username} a retiré ses réactions`);
                } else {
                    console.log(`[❌ REMOVE] ${client.user.username} - Message introuvable`);
                }
            } catch (err) {
                console.log(`[❌ REMOVE] ${client.user.username} - ${err.message}`);
            }
        });
        
        await Promise.all(unreactPromises);
        
        console.log(`\n✅ ${unreactCount}/${total} comptes ont unreact\n`);
        socket.emit('react-update', { message: `${unreactCount}/${total} comptes ont retiré leurs réactions` });
    });

    socket.on('play-soundboard', async (data) => {
        (async () => {
            try {
                const { audioData, volume, fileName } = data;
                
                console.log(`[📊 SOUNDBOARD] Lecture de ${fileName} (volume: ${Math.round(volume * 100)}%)`);
                
                const tempDir = path.join(__dirname, 'temp');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir);
                }
                
                const timestamp = Date.now();
                const tempFilePath = path.join(tempDir, `soundboard_${timestamp}.mp3`);
                
                const audioBuffer = Buffer.from(audioData, 'base64');
                fs.writeFileSync(tempFilePath, audioBuffer);
                
                const connectedClients = Array.from(clients.values()).filter(c => {
                    try {
                        return c.voice && c.voice.connection && c.voice.connection.state && c.voice.connection.state.status !== 'destroyed';
                    } catch {
                        return false;
                    }
                });
                
                if (connectedClients.length === 0) {
                    socket.emit('soundboard-update', { message: '⚠️ Aucun compte connecté au vocal' });
                    console.log('[⚠️ SOUNDBOARD] Aucun compte en vocal');
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    return;
                }
                
                console.log(`[📊 INFO] ${connectedClients.length} comptes en vocal détectés`);
                
                let playCount = 0;
                const total = connectedClients.length;
                
                connectedClients.forEach((client, index) => {
                    setTimeout(() => {
                        try {
                            const connection = client.voice.connection;
                            
                            if (!connection) {
                                console.log(`[❌] ${client.user.username} - Pas de connexion`);
                                return;
                            }
                            
                            const stream = fs.createReadStream(tempFilePath);
                            
                            const dispatcher = connection.play(stream, {
                                type: 'unknown',
                                volume: volume
                            });
                            
                            playCount++;
                            console.log(`[📊 ${playCount}/${total}] ${client.user.username} diffuse le son`);
                            
                            dispatcher.on('start', () => {
                                console.log(`[▶️] ${client.user.username} - Lecture démarrée`);
                            });
                            
                            dispatcher.on('error', (err) => {
                                console.log(`[❌ AUDIO] ${client.user.username} - ${err.message}`);
                            });
                            
                            dispatcher.on('finish', () => {
                                console.log(`[✅] ${client.user.username} - Terminé`);
                            });
                            
                        } catch (err) {
                            console.log(`[❌ PLAY] ${client.user.username} - ${err.message}`);
                        }
                    }, index * 30);
                });
                
                setTimeout(() => {
                    console.log(`\n✅ ${playCount}/${total} comptes diffusent le son\n`);
                    socket.emit('soundboard-update', { message: `${playCount}/${total} comptes diffusent le son` });
                }, total * 30 + 500);
                
                setTimeout(() => {
                    try {
                        if (fs.existsSync(tempFilePath)) {
                            fs.unlinkSync(tempFilePath);
                            console.log(`[🗑️] Fichier temporaire supprimé: ${fileName}`);
                        }
                    } catch (err) {
                        console.log(`[⚠️] Erreur suppression: ${err.message}`);
                    }
                }, 20000);
                
            } catch (err) {
                console.log(`[❌ SOUNDBOARD FATAL] ${err.message}`);
                console.error(err.stack);
                socket.emit('soundboard-update', { message: `Erreur fatale: ${err.message}` });
            }
        })().catch(err => {
            console.error('[❌ WRAPPER ERROR]', err);
        });
    });

    // ==================== NOUVELLES FONCTIONS AVEC PROXIES ====================

    // JOIN SERVER avec proxies + captcha
    socket.on('join-server', async (data) => {
        const { inviteCode, limit, delayBetween } = data;
        const accountLimit = limit || 0;
        const delay = delayBetween || 2000;
        
        console.log(`[🌐 JOIN SERVER] Rejoindre ${inviteCode} avec proxies`);
        
        const clientsArray = Array.from(clients.entries());
        const clientsToJoin = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;
        
        let joinCount = 0;
        const total = clientsToJoin.length;
        
        for (let i = 0; i < clientsToJoin.length; i++) {
            const [token, client] = clientsToJoin[i];
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
                const proxyUrl = getProxy(i);
                const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;
                
                // Extraire le code d'invitation propre
                let cleanInvite = inviteCode;
                if (inviteCode.includes('discord.gg/')) {
                    cleanInvite = inviteCode.split('discord.gg/')[1];
                } else if (inviteCode.includes('invite/')) {
                    cleanInvite = inviteCode.split('invite/')[1];
                }
                cleanInvite = cleanInvite.split('?')[0].split('/')[0];
                
                // Accepter l'invitation avec l'API REST
                try {
                    await axios.post(
                        `https://discord.com/api/v9/invites/${cleanInvite}`,
                        {},
                        {
                            headers: {
                                'Authorization': token,
                                'Content-Type': 'application/json',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            },
                            httpsAgent: agent
                        }
                    );
                    joinCount++;
                    console.log(`[✅ ${joinCount}/${total}] ${client.user.username} a rejoint`);
                    socket.emit('joinserver-update', { 
                        message: `${client.user.username} a rejoint (${joinCount}/${total})`,
                        count: joinCount,
                        total: total
                    });
                } catch (joinErr) {
                    if (joinErr.response?.data?.captcha_key) {
                        // Captcha requis
                        console.log(`[🔐 CAPTCHA] ${client.user.username} - Résolution du captcha...`);
                        
                        try {
                            const captchaSolution = await solve2Captcha(
                                joinErr.response.data.captcha_sitekey,
                                'https://discord.com'
                            );
                            
                            // Réessayer avec la solution captcha
                            await axios.post(
                                `https://discord.com/api/v9/invites/${cleanInvite}`,
                                { captcha_key: captchaSolution },
                                {
                                    headers: {
                                        'Authorization': token,
                                        'Content-Type': 'application/json',
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                    },
                                    httpsAgent: agent
                                }
                            );
                            
                            joinCount++;
                            console.log(`[✅ ${joinCount}/${total}] ${client.user.username} a rejoint (avec captcha)`);
                            socket.emit('joinserver-update', { 
                                message: `${client.user.username} a rejoint avec captcha (${joinCount}/${total})`,
                                count: joinCount,
                                total: total
                            });
                        } catch (captchaErr) {
                            const captchaErrMsg = captchaErr.response?.data?.message || captchaErr.message;
                            console.log(`[❌ CAPTCHA] ${client.user.username} - ${captchaErrMsg}`);
                            socket.emit('joinserver-update', { 
                                message: `${client.user.username} - Erreur captcha: ${captchaErrMsg}`,
                                count: joinCount,
                                total: total
                            });
                        }
                    } else {
                        throw joinErr;
                    }
                }
            } catch (err) {
                const errorMsg = err.response?.data?.message || err.message;
                console.log(`[❌ SERVER] ${client.user.username} - ${errorMsg}`);
                socket.emit('joinserver-update', { 
                    message: `${client.user.username} - Erreur: ${errorMsg}`,
                    count: joinCount,
                    total: total
                });
            }
        }
        
        console.log(`\n✅ ${joinCount}/${total} comptes ont rejoint le serveur\n`);
        socket.emit('joinserver-complete', { success: joinCount, total: total });
    });

    // SPAM DM avec proxies
    socket.on('spam-dm', async (data) => {
        const { userId, message, count, limit, delayBetween } = data;
        const accountLimit = limit || 0;
        const delay = delayBetween || 1500;
        const messageCount = count || 1;
        
        console.log(`[💬 SPAM DM] Envoi de ${messageCount} messages à ${userId}`);
        
        const clientsArray = Array.from(clients.entries());
        const clientsToSpam = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;
        
        let sentCount = 0;
        const total = clientsToSpam.length * messageCount;
        
        for (let i = 0; i < clientsToSpam.length; i++) {
            const [token, client] = clientsToSpam[i];
            
            for (let j = 0; j < messageCount; j++) {
                await new Promise(resolve => setTimeout(resolve, delay));
                
                try {
                    const proxyUrl = getProxy(i);
                    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;
                    
                    // Créer le channel DM avec l'API REST directement
                    let channelId;
                    try {
                        const dmChannelResponse = await axios.post(
                            'https://discord.com/api/v9/users/@me/channels',
                            { recipient_id: userId },
                            {
                                headers: {
                                    'Authorization': token,
                                    'Content-Type': 'application/json',
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                },
                                httpsAgent: agent
                            }
                        );
                        channelId = dmChannelResponse.data.id;
                    } catch (dmErr) {
                        if (dmErr.response?.data?.captcha_key) {
                            // Captcha requis pour créer le DM
                            console.log(`[🔐 CAPTCHA] ${client.user.username} - Résolution pour création DM...`);
                            
                            try {
                                const captchaSolution = await solve2Captcha(
                                    dmErr.response.data.captcha_sitekey,
                                    'https://discord.com'
                                );
                                
                                // Réessayer avec captcha
                                const dmChannelRetry = await axios.post(
                                    'https://discord.com/api/v9/users/@me/channels',
                                    { 
                                        recipient_id: userId,
                                        captcha_key: captchaSolution
                                    },
                                    {
                                        headers: {
                                            'Authorization': token,
                                            'Content-Type': 'application/json',
                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                        },
                                        httpsAgent: agent
                                    }
                                );
                                channelId = dmChannelRetry.data.id;
                                console.log(`[✅ CAPTCHA] ${client.user.username} - DM channel créé avec captcha`);
                            } catch (captchaErr) {
                                console.log(`[❌ CAPTCHA] ${client.user.username} - ${captchaErr.message}`);
                                continue;
                            }
                        } else {
                            throw dmErr;
                        }
                    }
                    
                    // Envoyer le message avec l'API REST
                    try {
                        await axios.post(
                            `https://discord.com/api/v9/channels/${channelId}/messages`,
                            { content: message },
                            {
                                headers: {
                                    'Authorization': token,
                                    'Content-Type': 'application/json',
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                },
                                httpsAgent: agent
                            }
                        );
                        sentCount++;
                        console.log(`[💬 ${sentCount}/${total}] ${client.user.username} - Message envoyé (${j+1}/${messageCount})`);
                        socket.emit('spamdm-update', { 
                            message: `${client.user.username}: ${sentCount}/${total} messages`,
                            count: sentCount,
                            total: total
                        });
                    } catch (msgErr) {
                        if (msgErr.response?.data?.captcha_key) {
                            // Captcha requis pour envoyer le message
                            console.log(`[🔐 CAPTCHA] ${client.user.username} - Résolution pour envoi message...`);
                            
                            try {
                                const captchaSolution = await solve2Captcha(
                                    msgErr.response.data.captcha_sitekey,
                                    'https://discord.com'
                                );
                                
                                // Réessayer avec captcha
                                await axios.post(
                                    `https://discord.com/api/v9/channels/${channelId}/messages`,
                                    { 
                                        content: message,
                                        captcha_key: captchaSolution
                                    },
                                    {
                                        headers: {
                                            'Authorization': token,
                                            'Content-Type': 'application/json',
                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                        },
                                        httpsAgent: agent
                                    }
                                );
                                sentCount++;
                                console.log(`[💬 ${sentCount}/${total}] ${client.user.username} - Message envoyé avec captcha (${j+1}/${messageCount})`);
                                socket.emit('spamdm-update', { 
                                    message: `${client.user.username}: ${sentCount}/${total} messages (captcha)`,
                                    count: sentCount,
                                    total: total
                                });
                            } catch (captchaErr) {
                                console.log(`[❌ CAPTCHA] ${client.user.username} - ${captchaErr.message}`);
                            }
                        } else {
                            throw msgErr;
                        }
                    }
                    
                } catch (err) {
                    const errorMsg = err.response?.data?.message || err.message;
                    console.log(`[❌ DM] ${client.user.username} - ${errorMsg}`);
                    if (errorMsg.includes('rate limit')) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            }
        }
        
        console.log(`\n✅ ${sentCount}/${total} messages envoyés\n`);
        socket.emit('spamdm-complete', { success: sentCount, total: total });
    });

    // CHANGE PROFILE avec proxies
    socket.on('change-profile', async (data) => {
        const { bio, limit, delayBetween } = data;
        const accountLimit = limit || 0;
        const delay = delayBetween || 2000;
        
        console.log(`[👤 PROFILE] Changement de bio avec proxies`);
        
        const clientsArray = Array.from(clients.entries());
        const clientsToUpdate = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;
        
        let updateCount = 0;
        const total = clientsToUpdate.length;
        
        for (let i = 0; i < clientsToUpdate.length; i++) {
            const [token, client] = clientsToUpdate[i];
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
                const proxyUrl = getProxy(i);
                const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;
                
                await axios.patch(
                    'https://discord.com/api/v9/users/@me/profile',
                    { bio: bio },
                    {
                        headers: {
                            'Authorization': token,
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        httpsAgent: agent
                    }
                );
                updateCount++;
                console.log(`[✅ ${updateCount}/${total}] ${client.user.username} - Bio modifiée`);
                socket.emit('profile-update', { 
                    message: `${client.user.username} bio modifiée (${updateCount}/${total})`,
                    count: updateCount,
                    total: total
                });
            } catch (err) {
                const errorMsg = err.response?.data?.message || err.message;
                console.log(`[❌ BIO] ${client.user.username} - ${errorMsg}`);
                if (errorMsg.includes('rate limit')) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
        }
        
        console.log(`\n✅ ${updateCount}/${total} bios modifiées\n`);
        socket.emit('profile-complete', { success: updateCount, total: total });
    });

    // CHANGE USERNAME avec proxies
    socket.on('change-username', async (data) => {
        const { username, limit, delayBetween } = data;
        const accountLimit = limit || 0;
        const delay = delayBetween || 3000;
        
        console.log(`[📝 USERNAME] Changement de pseudo avec proxies`);
        
        const clientsArray = Array.from(clients.entries());
        const clientsToUpdate = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;
        
        let updateCount = 0;
        const total = clientsToUpdate.length;
        
        for (let i = 0; i < clientsToUpdate.length; i++) {
            const [token, client] = clientsToUpdate[i];
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
                const proxyUrl = getProxy(i);
                const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;
                const newUsername = `${username}${Math.floor(Math.random() * 9999)}`;
                
                await axios.patch(
                    'https://discord.com/api/v9/users/@me',
                    { username: newUsername },
                    {
                        headers: {
                            'Authorization': token,
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        httpsAgent: agent
                    }
                );
                updateCount++;
                console.log(`[✅ ${updateCount}/${total}] ${client.user.username} → ${newUsername}`);
                socket.emit('username-update', { 
                    message: `${client.user.username} → ${newUsername} (${updateCount}/${total})`,
                    count: updateCount,
                    total: total
                });
            } catch (err) {
                const errorMsg = err.response?.data?.message || err.message;
                console.log(`[❌ USERNAME] ${client.user.username} - ${errorMsg}`);
                if (errorMsg.includes('rate limit')) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }
        
        console.log(`\n✅ ${updateCount}/${total} pseudos modifiés\n`);
        socket.emit('username-complete', { success: updateCount, total: total });
    });

    // CHANGE DISPLAY NAME avec proxies
    socket.on('change-displayname', async (data) => {
        const { displayName, guildId, limit, delayBetween } = data;
        const accountLimit = limit || 0;
        const delay = delayBetween || 2000;
        
        console.log(`[📛 DISPLAYNAME] Changement de nom d'affichage avec proxies`);
        
        const clientsArray = Array.from(clients.entries());
        const clientsToUpdate = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;
        
        let updateCount = 0;
        const total = clientsToUpdate.length;
        
        for (let i = 0; i < clientsToUpdate.length; i++) {
            const [token, client] = clientsToUpdate[i];
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
                const proxyUrl = getProxy(i);
                const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;
                
                if (guildId) {
                    // Changer le surnom sur un serveur spécifique
                    await axios.patch(
                        `https://discord.com/api/v9/guilds/${guildId}/members/@me`,
                        { nick: displayName },
                        {
                            headers: {
                                'Authorization': token,
                                'Content-Type': 'application/json',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            },
                            httpsAgent: agent
                        }
                    );
                    updateCount++;
                    console.log(`[✅ ${updateCount}/${total}] ${client.user.username} - Surnom serveur modifié`);
                } else {
                    // Changer le display name global
                    await axios.patch(
                        'https://discord.com/api/v9/users/@me',
                        { global_name: displayName },
                        {
                            headers: {
                                'Authorization': token,
                                'Content-Type': 'application/json',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            },
                            httpsAgent: agent
                        }
                    );
                    updateCount++;
                    console.log(`[✅ ${updateCount}/${total}] ${client.user.username} - Display name modifié`);
                }
                socket.emit('displayname-update', { 
                    message: `${client.user.username} nom modifié (${updateCount}/${total})`,
                    count: updateCount,
                    total: total
                });
            } catch (err) {
                const errorMsg = err.response?.data?.message || err.message;
                console.log(`[❌ DISPLAY] ${client.user.username} - ${errorMsg}`);
                if (errorMsg.includes('rate limit')) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
        }
        
        console.log(`\n✅ ${updateCount}/${total} noms modifiés\n`);
        socket.emit('displayname-complete', { success: updateCount, total: total });
    });

    // CHANGE AVATAR avec proxies
    socket.on('change-avatar', async (data) => {
        const { imageData, limit, delayBetween } = data;
        const accountLimit = limit || 0;
        const delay = delayBetween || 3000;
        
        console.log(`[🖼️ AVATAR] Changement d'avatar avec proxies`);
        
        const clientsArray = Array.from(clients.entries());
        const clientsToUpdate = accountLimit > 0 ? clientsArray.slice(0, accountLimit) : clientsArray;
        
        let updateCount = 0;
        const total = clientsToUpdate.length;
        
        for (let i = 0; i < clientsToUpdate.length; i++) {
            const [token, client] = clientsToUpdate[i];
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
                const proxyUrl = getProxy(i);
                const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;
                
                await axios.patch(
                    'https://discord.com/api/v9/users/@me',
                    { avatar: imageData },
                    {
                        headers: {
                            'Authorization': token,
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        httpsAgent: agent
                    }
                );
                updateCount++;
                console.log(`[✅ ${updateCount}/${total}] ${client.user.username} - Avatar modifié`);
                socket.emit('avatar-update', { 
                    message: `${client.user.username} avatar modifié (${updateCount}/${total})`,
                    count: updateCount,
                    total: total
                });
            } catch (err) {
                const errorMsg = err.response?.data?.message || err.message;
                console.log(`[❌ AVATAR] ${client.user.username} - ${errorMsg}`);
                if (errorMsg.includes('rate limit')) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }
        
        console.log(`\n✅ ${updateCount}/${total} avatars modifiés\n`);
        socket.emit('avatar-complete', { success: updateCount, total: total });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║       🚀 VOCAL JOINER PRO - BY AHKI & HEXEC      ║');
    console.log('╚═══════════════════════════════════════════════╝\n');
    console.log(`✅ Serveur prêt sur http://localhost:${PORT}`);
    console.log('📱 Interface web accessible dans votre navigateur');
    console.log(`🔒 ${proxies.length} proxies chargés`);
    console.log(`🔑 2Captcha: ${captchaKey ? 'Configuré' : 'Non configuré'}`);
    console.log('\n⚠️  Pour arrêter le serveur, fermez cette fenêtre ou appuyez sur CTRL+C\n');
});

process.on('SIGINT', () => {
    console.log('\n\n👋 Arrêt du serveur...');
    console.log('🔌 Déconnexion de tous les clients...');
    clients.forEach(c => c.destroy());
    clients.clear();
    console.log('✅ Serveur arrêté proprement\n');
    process.exit(0);
});