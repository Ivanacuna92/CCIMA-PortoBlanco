require('dotenv').config();

const WhatsAppBot = require('./src/bot/whatsappBot');
const WebServer = require('./src/web/server');
const config = require('./src/config/config');
const databaseInit = require('./src/services/databaseInit');

// Voicebot (opcional - solo si está configurado)
let campaignManager = null;

// Crear instancia del bot
const bot = new WhatsAppBot();

// Exponer instancia del bot globalmente para el servidor web
global.whatsappBot = bot;

// Crear instancia del servidor web
const webServer = new WebServer(config.webPort);

// Iniciar bot y servidor web
async function start() {
    // Inicializar base de datos
    await databaseInit.createTables();

    // Iniciar servidor web PRIMERO para que esté disponible mientras se conecta WhatsApp
    webServer.start();

    // Inicializar Voicebot EN PARALELO (no esperar a WhatsApp)
    if (process.env.ASTERISK_ARI_URL) {
        (async () => {
            try {
                campaignManager = require('./src/services/voicebot/campaignManager');
                await campaignManager.initialize();
                console.log('[Voicebot] Conectado a Asterisk ARI');
            } catch (error) {
                console.log('[Voicebot] No se pudo conectar a Asterisk:', error.message);
                console.log('[Voicebot] El panel funcionará pero sin llamadas');
            }
        })();
    }

    // Luego iniciar el bot (puede tardar esperando el QR)
    await bot.start();
}

start().catch(console.error);

// Manejar cierre limpio
process.on('SIGINT', async () => {
    console.log('\n⏹️  Cerrando aplicación...');
    await bot.stop();
    process.exit(0);
});