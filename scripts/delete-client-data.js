#!/usr/bin/env node

/**
 * Script para borrar toda la data de un cliente específico
 * Uso: node scripts/delete-client-data.js <numero_telefono>
 * Ejemplo: node scripts/delete-client-data.js 5214421234567
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const http = require('http');

// Colores para consola
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

const log = {
    error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
    warning: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
    info: (msg) => console.log(`${colors.cyan}ℹ️  ${msg}${colors.reset}`),
    step: (msg) => console.log(`${colors.blue}▶ ${msg}${colors.reset}`),
};

// Función para preguntar confirmación
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

// Función para borrar datos del usuario en user-data.json
async function deleteUserData(userId) {
    const userDataFile = path.join(process.cwd(), 'data', 'user-data.json');

    try {
        const data = await fs.readFile(userDataFile, 'utf8');
        const userData = JSON.parse(data);

        if (userData[userId]) {
            delete userData[userId];
            await fs.writeFile(userDataFile, JSON.stringify(userData, null, 2));
            log.success(`Datos del usuario eliminados de user-data.json`);
            return true;
        } else {
            log.warning(`No se encontraron datos del usuario en user-data.json`);
            return false;
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            log.warning('Archivo user-data.json no existe');
            return false;
        }
        throw error;
    }
}

// Función para borrar estados de modo humano
async function deleteHumanModeState(userId) {
    // Primero intentar con base de datos SQLite
    try {
        const database = require('../src/services/database');
        await database.delete('human_mode_states', 'contact_id = ?', [userId]);
        log.success('Estado de modo humano eliminado de la base de datos');
        return true;
    } catch (error) {
        log.warning('No se pudo eliminar de la base de datos (puede que no exista)');
    }

    // Fallback a archivo JSON legacy si existe
    const humanStatesFile = path.join(process.cwd(), 'data', 'human-states.json');
    try {
        const data = await fs.readFile(humanStatesFile, 'utf8');
        const humanStates = JSON.parse(data);

        if (humanStates[userId]) {
            delete humanStates[userId];
            await fs.writeFile(humanStatesFile, JSON.stringify(humanStates, null, 2));
            log.success('Estado de modo humano eliminado de human-states.json');
            return true;
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    return false;
}

// Función para borrar sesiones de conversación
async function deleteSessionData(userId) {
    try {
        const database = require('../src/services/database');
        await database.delete('user_sessions', 'user_id = ?', [userId]);
        log.success('Sesión de conversación eliminada de la base de datos');
        return true;
    } catch (error) {
        log.warning('No se pudo eliminar la sesión de la base de datos');
        return false;
    }
}

// Función para borrar seguimientos activos
async function deleteFollowUpData(userId) {
    try {
        const database = require('../src/services/database');
        await database.delete('follow_up_schedules', 'user_id = ?', [userId]);
        log.success('Seguimientos programados eliminados de la base de datos');
        return true;
    } catch (error) {
        log.warning('No se pudo eliminar seguimientos (puede que no existan)');
        return false;
    }
}

// Función para limpiar caché del servidor (si está corriendo)
async function clearServerCache(userId) {
    try {
        // Intentar conectar con el servidor local
        const options = {
            hostname: 'localhost',
            port: process.env.WEB_PORT || 3001,
            path: `/api/clear-cache/${userId}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Nota: En producción necesitarías autenticación
            },
            timeout: 3000
        };

        return new Promise((resolve) => {
            const req = http.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        log.success('Caché del servidor limpiado');
                        resolve(true);
                    } else {
                        log.warning('No se pudo limpiar el caché del servidor (puede que no esté corriendo o requiera autenticación)');
                        resolve(false);
                    }
                });
            });

            req.on('error', () => {
                log.warning('Servidor no está corriendo - el caché se limpiará al reiniciar');
                resolve(false);
            });

            req.on('timeout', () => {
                req.destroy();
                log.warning('Timeout al contactar el servidor');
                resolve(false);
            });

            req.end();
        });
    } catch (error) {
        log.warning('No se pudo contactar el servidor para limpiar caché');
        return false;
    }
}

// Función para borrar logs del cliente
async function deleteClientLogs(userId) {
    const logsDir = path.join(process.cwd(), 'logs');

    try {
        const files = await fs.readdir(logsDir);
        let deletedLogs = 0;

        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(logsDir, file);
                const content = await fs.readFile(filePath, 'utf8');
                const logs = JSON.parse(content);

                const originalLength = logs.length;
                const filteredLogs = logs.filter(log => log.userId !== userId);

                if (filteredLogs.length < originalLength) {
                    await fs.writeFile(filePath, JSON.stringify(filteredLogs, null, 2));
                    deletedLogs += (originalLength - filteredLogs.length);
                }
            }
        }

        if (deletedLogs > 0) {
            log.success(`${deletedLogs} entradas de logs eliminadas`);
            return true;
        } else {
            log.warning('No se encontraron logs del usuario');
            return false;
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            log.warning('Directorio de logs no existe');
            return false;
        }
        throw error;
    }
}

// Función principal
async function deleteClientData(userId) {
    console.log('\n' + '='.repeat(60));
    log.info(`Iniciando eliminación de datos para: ${userId}`);
    console.log('='.repeat(60) + '\n');

    const results = {
        userData: false,
        humanMode: false,
        session: false,
        followUp: false,
        logs: false,
        cache: false,
    };

    try {
        log.step('1/6 Eliminando datos del usuario...');
        results.userData = await deleteUserData(userId);

        log.step('2/6 Eliminando estados de modo humano...');
        results.humanMode = await deleteHumanModeState(userId);

        log.step('3/6 Eliminando sesiones de conversación...');
        results.session = await deleteSessionData(userId);

        log.step('4/6 Eliminando seguimientos programados...');
        results.followUp = await deleteFollowUpData(userId);

        log.step('5/6 Eliminando logs del cliente...');
        results.logs = await deleteClientLogs(userId);

        log.step('6/6 Limpiando caché del servidor...');
        results.cache = await clearServerCache(userId);

        console.log('\n' + '='.repeat(60));
        log.success('Proceso completado');
        console.log('='.repeat(60) + '\n');

        // Resumen
        const deletedCount = Object.values(results).filter(v => v).length;
        if (deletedCount > 0) {
            log.success(`Se eliminaron datos de ${deletedCount} ubicaciones`);
        } else {
            log.warning('No se encontraron datos del usuario en ninguna ubicación');
        }

    } catch (error) {
        console.error('\n');
        log.error('Error durante la eliminación:');
        console.error(error);
        process.exit(1);
    }
}

// Script principal
async function main() {
    const userId = process.argv[2];
    const skipConfirmation = process.argv[3] === '--yes' || process.argv[3] === '-y';

    if (!userId) {
        console.log('\n' + colors.cyan + 'Script para eliminar datos de un cliente' + colors.reset);
        console.log('\nUso: node scripts/delete-client-data.js <numero_telefono> [--yes|-y]');
        console.log('Ejemplo: node scripts/delete-client-data.js 5214421234567');
        console.log('Ejemplo (sin confirmación): node scripts/delete-client-data.js 5214421234567 --yes\n');
        process.exit(1);
    }

    // Confirmación (solo si no se usa --yes)
    if (!skipConfirmation) {
        log.warning(`Estás a punto de eliminar TODOS los datos de: ${userId}`);
        log.warning('Esta acción NO se puede deshacer\n');

        const answer = await askQuestion('¿Estás seguro? (escribe "si" para confirmar): ');

        if (answer.toLowerCase() !== 'si' && answer.toLowerCase() !== 'sí') {
            log.info('Operación cancelada');
            process.exit(0);
        }
    } else {
        log.info(`Eliminando datos de ${userId} (confirmación automática)...\n`);
    }

    await deleteClientData(userId);
}

// Ejecutar
main();
