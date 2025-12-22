const database = require('./database');
const logger = require('./logger');
const config = require('../config/config');

class FollowUpManager {
    constructor() {
        this.followUps = new Map(); // Cache local para seguimientos activos
        this.checkInterval = 2 * 60 * 60 * 1000; // 2 horas (revisión en producción)
        this.followUpInterval = 24 * 60 * 60 * 1000; // 24 horas entre seguimientos
        this.maxFollowUps = 3; // LÍMITE MÁXIMO de mensajes de seguimiento

        // Palabras clave de rechazo para verificación directa (sin depender de IA)
        this.rejectionKeywords = [
            'no me interesa', 'no gracias', 'no quiero', 'no es para mi', 'no es para mí',
            'ya no', 'no estoy interesado', 'no estoy interesada', 'dejen de', 'no me escriban',
            'no me contacten', 'basta', 'ya estuvo', 'parenle', 'párenle', 'ya les dije',
            'dejen de molestar', 'no molesten', 'nel', 'nop', 'para nada', 'olvídalo', 'olvidalo',
            'dejalo', 'déjalo', 'no necesito', 'gracias pero no', 'por el momento no',
            'ahorita no', 'ahora no', 'después', 'despues', 'luego les marco', 'ya no me interesa',
            'no me interesa ya', 'ya no quiero', 'cancela', 'cancelar', 'no thanks', 'stop',
            'ya basta', 'ya parele', 'ya párale', 'suficiente', 'ya fue suficiente'
        ];
    }

    // Verificación directa de rechazo sin depender de IA
    containsRejectionKeyword(message) {
        if (!message) return false;
        const lowerMessage = message.toLowerCase().trim();
        return this.rejectionKeywords.some(keyword => lowerMessage.includes(keyword));
    }

    async initialize() {
        try {
            // Cargar seguimientos activos desde BD al iniciar
            const activeFollowUps = await database.query(
                'SELECT * FROM follow_ups WHERE status = "active"'
            );

            for (const followUp of activeFollowUps) {
                this.followUps.set(followUp.user_id, {
                    userId: followUp.user_id,
                    chatId: followUp.chat_id,
                    lastFollowUp: new Date(followUp.last_follow_up).getTime(),
                    followUpCount: followUp.follow_up_count,
                    status: followUp.status,
                    startedAt: new Date(followUp.started_at).getTime()
                });
            }

            console.log(`✓ FollowUpManager inicializado con ${activeFollowUps.length} seguimientos activos`);
        } catch (error) {
            console.error('Error inicializando FollowUpManager:', error);
        }
    }

    async startFollowUp(userId, chatId) {
        try {
            console.log(`[FollowUp] 🔍 Intentando iniciar seguimiento para ${userId}`);

            // Verificar si ya existe un seguimiento activo
            const existing = await database.findOne('follow_ups', 'user_id = ? AND status = "active"', [userId]);

            if (existing) {
                console.log(`[FollowUp] ⚠️ Seguimiento ya activo para usuario ${userId}`);
                return;
            }

            // Crear nuevo seguimiento
            const now = new Date();
            console.log(`[FollowUp] 📝 Insertando en BD para ${userId}...`);

            await database.insert('follow_ups', {
                user_id: userId,
                chat_id: chatId,
                last_follow_up: now,
                follow_up_count: 0,
                status: 'active',
                started_at: now
            });

            // Agregar a cache local
            this.followUps.set(userId, {
                userId,
                chatId,
                lastFollowUp: now.getTime(),
                followUpCount: 0,
                status: 'active',
                startedAt: now.getTime()
            });

            await logger.log('SYSTEM', 'Seguimiento automático iniciado', userId);
            console.log(`[FollowUp] ✅ Seguimiento iniciado exitosamente para ${userId}`);
            console.log(`[FollowUp] 📊 Total seguimientos activos: ${this.followUps.size}`);
        } catch (error) {
            console.error(`[FollowUp] ❌ Error iniciando seguimiento para ${userId}:`, error);
        }
    }

    async stopFollowUp(userId, reason = 'manual') {
        try {
            // Actualizar en BD
            await database.update('follow_ups',
                {
                    status: 'stopped',
                    stopped_reason: reason,
                    stopped_at: new Date()
                },
                'user_id = ? AND status = "active"',
                [userId]
            );

            // Remover de cache local
            this.followUps.delete(userId);

            await logger.log('SYSTEM', `Seguimiento detenido: ${reason}`, userId);
            console.log(`✓ Seguimiento detenido para usuario ${userId}: ${reason}`);
        } catch (error) {
            console.error('Error deteniendo seguimiento:', error);
        }
    }

    async isFollowUpActive(userId) {
        return this.followUps.has(userId);
    }

    async getFollowUpStatus(userId) {
        return this.followUps.get(userId) || null;
    }

    async checkPendingFollowUps(sock, aiService, sessionManager) {
        const now = Date.now();
        console.log(`[FollowUp] 🔄 Revisando seguimientos pendientes... Total activos: ${this.followUps.size}`);

        for (const [userId, followUp] of this.followUps.entries()) {
            try {
                // Verificar si han pasado 24 horas desde el último seguimiento
                const timeSinceLastFollowUp = now - followUp.lastFollowUp;
                const hoursSinceLastFollowUp = Math.floor(timeSinceLastFollowUp / (60 * 60 * 1000));

                console.log(`[FollowUp] Usuario ${userId}:`);
                console.log(`  - Tiempo desde último seguimiento: ${hoursSinceLastFollowUp} horas`);
                console.log(`  - Contador de seguimientos: ${followUp.followUpCount}/${this.maxFollowUps}`);
                console.log(`  - Intervalo requerido: 24 horas`);

                // VERIFICACIÓN 1: Límite máximo de seguimientos alcanzado
                if (followUp.followUpCount >= this.maxFollowUps) {
                    console.log(`  - 🛑 LÍMITE MÁXIMO alcanzado (${this.maxFollowUps}), deteniendo seguimiento`);
                    await this.stopFollowUp(userId, 'limite_maximo_alcanzado');
                    continue;
                }

                if (timeSinceLastFollowUp >= this.followUpInterval) {
                    console.log(`  - ✅ Tiempo cumplido, verificando estado del cliente antes de enviar...`);

                    // Obtener mensajes del historial
                    const messages = await sessionManager.getMessages(userId);
                    const userMessages = messages ? messages.filter(m => m.role === 'user') : [];
                    const lastUserMessage = userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;

                    // VERIFICACIÓN 2: Verificación directa de palabras clave de rechazo (sin IA)
                    if (lastUserMessage && lastUserMessage.content) {
                        if (this.containsRejectionKeyword(lastUserMessage.content)) {
                            console.log(`  - 🛑 RECHAZO DETECTADO por palabra clave: "${lastUserMessage.content.substring(0, 50)}..."`);
                            await this.stopFollowUp(userId, 'rechazo_keyword_detectado');
                            continue;
                        }
                    }

                    // VERIFICACIÓN 3: Revisar TODOS los mensajes del usuario por palabras de rechazo
                    let foundRejection = false;
                    for (const msg of userMessages) {
                        if (msg.content && this.containsRejectionKeyword(msg.content)) {
                            console.log(`  - 🛑 RECHAZO ENCONTRADO en historial: "${msg.content.substring(0, 50)}..."`);
                            foundRejection = true;
                            break;
                        }
                    }
                    if (foundRejection) {
                        await this.stopFollowUp(userId, 'rechazo_en_historial');
                        continue;
                    }

                    // VERIFICACIÓN 4: Análisis con IA (si hay mensajes disponibles)
                    if (lastUserMessage && lastUserMessage.content) {
                        try {
                            const status = await aiService.analyzeConversationStatus(messages, lastUserMessage.content);
                            console.log(`  - 🔍 Estado según IA: ${status}`);

                            if (status === 'RECHAZADO' || status === 'FRUSTRADO' || status === 'ACEPTADO') {
                                console.log(`  - 🛑 Cliente ${status}, deteniendo seguimiento SIN enviar mensaje`);
                                await this.stopFollowUp(userId, `ia_${status.toLowerCase()}`);
                                continue;
                            }
                        } catch (aiError) {
                            console.error(`  - ⚠️ Error en análisis IA, usando verificación por keywords únicamente:`, aiError.message);
                            // Ya verificamos keywords arriba, así que podemos continuar
                        }
                    } else {
                        console.log(`  - ⚠️ No hay mensajes del usuario en historial, saltando este seguimiento por seguridad`);
                        continue; // NO enviar si no tenemos historial - mejor seguro que molestar
                    }

                    console.log(`  - ✅ Cliente aún activo/inactivo, generando mensaje...`);

                    // Generar mensaje de seguimiento usando IA
                    const followUpMessage = await this.generateFollowUpMessage(
                        userId,
                        followUp.followUpCount,
                        aiService,
                        sessionManager
                    );

                    console.log(`  - 📝 Mensaje generado: "${followUpMessage.substring(0, 50)}..."`);

                    // Enviar mensaje (usando whatsapp-web.js)
                    if (followUp.chatId && sock) {
                        console.log(`  - 📤 Enviando mensaje a ${followUp.chatId}...`);
                        await sock.sendMessage(followUp.chatId, followUpMessage);
                        await logger.log('BOT', followUpMessage, userId);

                        // Actualizar contador y timestamp
                        followUp.followUpCount++;
                        followUp.lastFollowUp = now;

                        // Actualizar en BD
                        await database.update('follow_ups',
                            {
                                last_follow_up: new Date(),
                                follow_up_count: followUp.followUpCount
                            },
                            'user_id = ?',
                            [userId]
                        );

                        // Actualizar cache
                        this.followUps.set(userId, followUp);

                        console.log(`  - ✅ Mensaje de seguimiento #${followUp.followUpCount} enviado exitosamente`);

                        // Si alcanzó el límite después de este envío, detener
                        if (followUp.followUpCount >= this.maxFollowUps) {
                            console.log(`  - 🛑 Límite máximo alcanzado tras envío, deteniendo seguimiento`);
                            await this.stopFollowUp(userId, 'limite_maximo_tras_envio');
                        }
                    } else {
                        console.log(`  - ❌ No se pudo enviar: chatId=${followUp.chatId}, sock=${!!sock}`);
                    }
                } else {
                    const hoursRemaining = Math.ceil((this.followUpInterval - timeSinceLastFollowUp) / (60 * 60 * 1000));
                    console.log(`  - ⏳ Faltan ${hoursRemaining} horas para el siguiente seguimiento`);
                }
            } catch (error) {
                console.error(`[FollowUp] ❌ Error procesando seguimiento para ${userId}:`, error);
                // En caso de error, NO enviar mensaje - mejor seguro
            }
        }

        if (this.followUps.size === 0) {
            console.log(`[FollowUp] 📭 No hay seguimientos activos`);
        }
    }

    async generateFollowUpMessage(userId, followUpCount, aiService, sessionManager) {
        try {
            // Obtener historial de conversación
            const messages = await sessionManager.getMessages(userId);

            // Crear prompt para generar mensaje de seguimiento
            const systemPrompt = {
                role: 'system',
                content: `Eres Daniel de Porto Blanco. El cliente dejó de responder hace 24 horas.

Esta es la conversación #${followUpCount + 1} de seguimiento.

IMPORTANTE:
- NO uses emojis
- Sé breve y profesional
- Retoma el contexto de la conversación anterior
- Si es el primer seguimiento (count 0): pregunta si aún está interesado y si tiene dudas
- Si es el segundo seguimiento (count 1): ofrece alternativas o menciona beneficios adicionales
- Si es el tercer seguimiento (count 2): menciona que es el último contacto y ofrece dejar información de contacto directo
- Máximo 2-3 líneas

Genera SOLO el mensaje de seguimiento, sin explicaciones adicionales.`
            };

            const userPrompt = {
                role: 'user',
                content: 'Genera un mensaje de seguimiento apropiado basado en la conversación anterior.'
            };

            const aiMessages = [systemPrompt, ...messages, userPrompt];
            const response = await aiService.generateResponse(aiMessages);

            return response;
        } catch (error) {
            console.error('Error generando mensaje de seguimiento:', error);

            // Fallback a mensajes predefinidos
            const fallbackMessages = [
                'Hola, quería darle seguimiento a nuestra conversación anterior. ¿Aún está interesado en conocer más sobre nuestros terrenos de inversión? ¿Tiene alguna duda que pueda resolver?',
                'Hola nuevamente. Veo que no hemos continuado con la conversación. ¿Le gustaría conocer otras opciones disponibles o recibir información adicional sobre ubicaciones y metrajes disponibles?',
                'Hola, este será mi último mensaje de seguimiento. Si desea información adicional, puede contactar directamente a Paola González al 4424634736 o al correo paola.gonzalez@grupoccima.com.mx. Estamos a su disposición.'
            ];

            return fallbackMessages[Math.min(followUpCount, 2)];
        }
    }

    async analyzeConversationStatus(userId, lastMessage, aiService, sessionManager) {
        try {
            // Obtener historial completo
            const messages = await sessionManager.getMessages(userId);

            // Crear prompt para analizar el estado
            const analysisPrompt = {
                role: 'system',
                content: `Analiza esta conversación y determina si se cumple alguna de estas condiciones:

1. ACEPTADO: El cliente mostró intención clara de proceder (pidió cita, proporcionó correo, dijo que sí está interesado)
2. RECHAZADO: El cliente rechazó explícitamente la oferta (dijo "no me interesa", "no gracias", "no es para mí")
3. FRUSTRADO: El cliente muestra frustración o enojo (usa lenguaje negativo, se queja, menciona insistencia molesta)
4. ACTIVO: La conversación sigue activa y productiva
5. INACTIVO: El cliente dejó de responder sin señales claras

Responde ÚNICAMENTE con una de estas palabras: ACEPTADO, RECHAZADO, FRUSTRADO, ACTIVO, o INACTIVO`
            };

            const userPrompt = {
                role: 'user',
                content: `Último mensaje del cliente: "${lastMessage}"\n\nAnaliza el estado de la conversación.`
            };

            const aiMessages = [analysisPrompt, ...messages, userPrompt];
            const response = await aiService.generateResponse(aiMessages);

            const status = response.trim().toUpperCase();

            // Manejar el resultado
            if (['ACEPTADO', 'RECHAZADO', 'FRUSTRADO'].includes(status)) {
                await this.stopFollowUp(userId, status.toLowerCase());
                return status;
            }

            return status;
        } catch (error) {
            console.error('Error analizando estado de conversación:', error);
            return 'ACTIVO'; // Default a activo en caso de error
        }
    }

    startFollowUpTimer(sock, aiService, sessionManager) {
        console.log('✓ Timer de seguimiento iniciado (revisión cada 2 horas)');
        console.log(`✓ Intervalo de seguimiento: 24 horas`);

        setInterval(() => {
            this.checkPendingFollowUps(sock, aiService, sessionManager);
        }, this.checkInterval);
    }

    async getAllActiveFollowUps() {
        return Array.from(this.followUps.values());
    }
}

module.exports = new FollowUpManager();
