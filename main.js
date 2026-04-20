const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;
const PORT = 3000;

// ========================================
// GESTION DES ERREURS GLOBALES
// ========================================
process.on('uncaughtException', (error) => {
    console.error('❌ ERREUR NON GÉRÉE:', error.message);
    console.error('Stack:', error.stack);
    // On ne crashe pas l'app, juste log
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ PROMISE REJETÉE:', reason);
});

// ========================================
// DÉMARRAGE DU SERVEUR NODE.JS
// ========================================
function startServer() {
    return new Promise((resolve, reject) => {
        console.log('🚀 Démarrage du serveur...');
        
        serverProcess = spawn('node', [path.join(__dirname, 'server.js')], {
            stdio: 'pipe',
            cwd: __dirname,
            env: { ...process.env, PORT: PORT }
        });

        // Capture des logs du serveur
        serverProcess.stdout.on('data', (data) => {
            console.log(`[SERVEUR] ${data.toString().trim()}`);
            if (data.toString().includes('Serveur prêt')) {
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(`[SERVEUR ERROR] ${data.toString().trim()}`);
        });

        serverProcess.on('error', (error) => {
            console.error('❌ Erreur de démarrage du serveur:', error);
            reject(error);
        });

        serverProcess.on('exit', (code, signal) => {
            if (code !== 0 && code !== null) {
                console.error(`❌ Le serveur s'est arrêté avec le code ${code}`);
            }
        });

        // Timeout de sécurité
        setTimeout(() => {
            resolve(); // On continue même si pas de confirmation
        }, 3000);
    });
}

// ========================================
// CRÉATION DE LA FENÊTRE ELECTRON
// ========================================
function createWindow() {
    console.log('🪟 Création de la fenêtre...');
    
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            devTools: true // Mettre false pour la production
        },
        title: 'Vocal Joiner PRO - by ahki & hexec',
        backgroundColor: '#1a1a1a',
        show: false, // Afficher seulement quand prêt
        autoHideMenuBar: true // Cacher la barre de menu
    });

    // Charger l'interface
    mainWindow.loadURL(`http://localhost:${PORT}`);

    // Afficher quand prêt (évite le flash blanc)
    mainWindow.once('ready-to-show', () => {
        console.log('✅ Fenêtre prête !');
        mainWindow.show();
    });

    // Gestion des erreurs de chargement
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error(`❌ Échec de chargement (${errorCode}):`, errorDescription);
        
        // Réessayer après 2 secondes
        setTimeout(() => {
            console.log('🔄 Nouvelle tentative de chargement...');
            mainWindow.loadURL(`http://localhost:${PORT}`);
        }, 2000);
    });

    // Log des erreurs console du renderer
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        if (level >= 2) { // Warnings et erreurs
            console.log(`[RENDERER] ${message}`);
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ========================================
// DÉMARRAGE DE L'APPLICATION
// ========================================
app.whenReady().then(async () => {
    console.log('\n╔═══════════════════════════════════════════════╗');
    console.log('║   🚀 VOCAL JOINER PRO - BY AHKI & HEXEC      ║');
    console.log('╚═══════════════════════════════════════════════╝\n');

    try {
        // Démarrer le serveur
        await startServer();
        
        // Créer la fenêtre
        createWindow();
        
        console.log('✅ Application démarrée avec succès !');
    } catch (error) {
        console.error('❌ Erreur au démarrage:', error);
        app.quit();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// ========================================
// FERMETURE PROPRE
// ========================================
app.on('window-all-closed', () => {
    console.log('\n👋 Fermeture de l\'application...');
    
    if (serverProcess) {
        console.log('🛑 Arrêt du serveur...');
        serverProcess.kill('SIGTERM');
        
        // Force kill après 2 secondes si pas fermé
        setTimeout(() => {
            if (serverProcess) {
                serverProcess.kill('SIGKILL');
            }
        }, 2000);
    }
    
    app.quit();
});

app.on('will-quit', () => {
    if (serverProcess) {
        serverProcess.kill('SIGKILL');
    }
});

// Gestion du Ctrl+C en mode dev
process.on('SIGINT', () => {
    console.log('\n\n⚠️  Interruption détectée (Ctrl+C)');
    app.quit();
});