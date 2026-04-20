// ========================================
// GESTIONNAIRE D'ERREURS CENTRALISÉ
// ========================================
// Ajoute ce code au début de ton server.js

const fs = require('fs');
const path = require('path');

// Créer un dossier logs si inexistant
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Fichier de log avec timestamp
const logFile = path.join(logsDir, `vocal-joiner-${new Date().toISOString().split('T')[0]}.log`);

// Fonction de log centralisée
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    
    // Console
    console.log(logMessage);
    if (data) {
        console.log(data);
    }
    
    // Fichier
    try {
        fs.appendFileSync(logFile, logMessage + '\n');
        if (data) {
            fs.appendFileSync(logFile, JSON.stringify(data, null, 2) + '\n');
        }
    } catch (err) {
        console.error('Erreur d\'écriture du log:', err.message);
    }
}

// ========================================
// GESTION DES ERREURS DISCORD.JS
// ========================================
function handleDiscordError(error, context, socket = null) {
    // Erreurs connues à ignorer (non critiques)
    const ignoredErrors = [
        'WebSocket was closed',
        'Connection reset',
        'ECONNRESET',
        'ETIMEDOUT',
        'Request timeout',
        'Unknown interaction'
    ];
    
    const errorMessage = error.message || error.toString();
    
    // Vérifier si c'est une erreur à ignorer
    if (ignoredErrors.some(err => errorMessage.includes(err))) {
        log('DEBUG', `[${context}] Erreur ignorée: ${errorMessage}`);
        return;
    }
    
    // Erreurs critiques
    log('ERROR', `[${context}] ${errorMessage}`, {
        stack: error.stack,
        code: error.code
    });
    
    // Notifier le client si socket disponible
    if (socket) {
        socket.emit('error-notification', {
            context,
            message: errorMessage,
            severity: 'warning'
        });
    }
}

// ========================================
// GESTION DES ERREURS SOCKET.IO
// ========================================
function handleSocketError(error, eventName, socket) {
    log('ERROR', `[SOCKET] Erreur sur l'événement "${eventName}"`, {
        message: error.message,
        stack: error.stack
    });
    
    socket.emit('error-notification', {
        event: eventName,
        message: `Erreur: ${error.message}`,
        severity: 'error'
    });
}

// ========================================
// WRAPPER DE SÉCURITÉ POUR EVENTS SOCKET
// ========================================
function safeSocketHandler(eventName, handler) {
    return async function(...args) {
        const socket = this; // 'this' est le socket dans le contexte
        
        try {
            await handler.apply(socket, args);
        } catch (error) {
            handleSocketError(error, eventName, socket);
        }
    };
}

// ========================================
// GESTION DES ERREURS GLOBALES
// ========================================
process.on('uncaughtException', (error) => {
    log('CRITICAL', 'ERREUR NON GÉRÉE (uncaughtException)', {
        message: error.message,
        stack: error.stack
    });
    
    // Ne pas crasher si c'est une erreur WebSocket
    if (error.message && error.message.includes('WebSocket was closed')) {
        return;
    }
    
    // Pour les autres erreurs critiques, logger et continuer
    console.error('⚠️  Erreur critique capturée, l\'application continue...');
});

process.on('unhandledRejection', (reason, promise) => {
    log('CRITICAL', 'PROMISE REJETÉE NON GÉRÉE', {
        reason: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : null
    });
});

// ========================================
// MONITORING DES RESSOURCES
// ========================================
function logSystemStatus() {
    const memUsage = process.memoryUsage();
    const status = {
        memory: {
            rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`
        },
        uptime: `${Math.floor(process.uptime())} secondes`,
        activeClients: global.clients ? global.clients.size : 0
    };
    
    log('INFO', 'Status système', status);
}

// Log toutes les 5 minutes
setInterval(logSystemStatus, 5 * 60 * 1000);

// ========================================
// EXPORTS
// ========================================
module.exports = {
    log,
    handleDiscordError,
    handleSocketError,
    safeSocketHandler,
    logSystemStatus
};

// ========================================
// EXEMPLE D'UTILISATION DANS TON CODE
// ========================================
/*
// Dans server.js, au début:
const { log, handleDiscordError, safeSocketHandler } = require('./error-handler');

// Remplacer:
socket.on('connect-tokens', async (tokens) => { ... });

// Par:
socket.on('connect-tokens', safeSocketHandler('connect-tokens', async function(tokens) {
    // Ton code ici
    // Les erreurs seront automatiquement capturées et loggées
}));

// Pour les erreurs Discord:
try {
    await client.login(token);
} catch (error) {
    handleDiscordError(error, 'LOGIN', socket);
}
*/