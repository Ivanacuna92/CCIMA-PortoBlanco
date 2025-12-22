#!/usr/bin/env node
/**
 * Parche para msedge-tts: corrige el error de JSON.stringify con estructura circular
 * Se ejecuta automáticamente después de npm install
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', 'msedge-tts', 'dist', 'MsEdgeTTS.js');

if (!fs.existsSync(filePath)) {
    console.log('[patch] msedge-tts no instalado, saltando parche');
    process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

const buggyCode = 'reject("Connect Error: " + JSON.stringify(error, null, 2))';
const fixedCode = `reject("Connect Error: " + (error && error.message ? error.message : 'WebSocket connection failed'))`;

if (content.includes(buggyCode)) {
    content = content.replace(buggyCode, fixedCode);
    fs.writeFileSync(filePath, content);
    console.log('[patch] msedge-tts parcheado correctamente');
} else if (content.includes(fixedCode)) {
    console.log('[patch] msedge-tts ya está parcheado');
} else {
    console.warn('[patch] No se encontró el código a parchear en msedge-tts');
}
