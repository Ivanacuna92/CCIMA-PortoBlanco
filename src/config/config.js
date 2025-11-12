require('dotenv').config();

module.exports = {
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    deepseekApiUrl: 'https://api.deepseek.com/v1/chat/completions',
    webPort: process.env.WEB_PORT || 3001,
    sessionTimeout: 5 * 60 * 1000, // 5 minutos
    checkInterval: 60000, // 1 minuto
    maxMessages: 10, // Máximo de mensajes en contexto

    // Configuración de Chrome/Chromium
    chromePath: process.env.CHROME_PATH || null, // Ruta a Chrome/Chromium instalado

    validateApiKey() {
        if (!this.deepseekApiKey || this.deepseekApiKey === 'tu_api_key_real_aqui') {
            console.error('⚠️  ERROR: No se ha configurado DEEPSEEK_API_KEY en el archivo .env');
            console.error('Por favor, crea un archivo .env y añade tu API key de DeepSeek');
            console.error('Ejemplo: DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxx');
            process.exit(1);
        }
    },

    // Detectar la ruta de Chrome según el sistema operativo
    getChromePath() {
        if (this.chromePath) {
            return this.chromePath;
        }

        const os = require('os');
        const fs = require('fs');
        const platform = os.platform();

        const paths = {
            linux: [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
                '/snap/bin/chromium'
            ],
            darwin: [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Chromium.app/Contents/MacOS/Chromium'
            ],
            win32: [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
            ]
        };

        const platformPaths = paths[platform] || [];

        for (const path of platformPaths) {
            if (fs.existsSync(path)) {
                console.log(`✅ Chrome encontrado en: ${path}`);
                return path;
            }
        }

        console.log('⚠️  Chrome no encontrado, usando Chromium de Puppeteer');
        return null;
    }
};