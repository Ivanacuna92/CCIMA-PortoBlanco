const EventEmitter = require('events');
const ariManager = require('./ariManager');
const openaiVoice = require('./openaiVoice');
const audioHandler = require('./audioHandler');
const voicebotDB = require('./voicebotDatabase');

class CampaignManager extends EventEmitter {
    constructor() {
        super();
        this.activeCampaigns = new Map();
        this.maxConcurrentCalls = parseInt(process.env.VOICEBOT_CONCURRENT_CALLS) || 2;
        this.activeCallsCount = 0;
        this.callHandlers = new Map();
        this.commonResponses = new Map();
    }

    async initialize() {
        await ariManager.connect();
        await audioHandler.initialize();

        // Escuchar llamadas contestadas
        ariManager.on('callAnswered', (data) => this.handleCallAnswered(data));

        // Pre-generar respuestas comunes (optimizacion de latencia)
        // Si falla, continuar sin respuestas pre-generadas
        try {
            await this.preGenerateCommonResponses();
        } catch (error) {
            console.warn('[CampaignManager] No se pudieron pre-generar respuestas:', error.message);
            console.warn('[CampaignManager] El voicebot funcionará pero con mayor latencia');
        }

        console.log('[CampaignManager] Inicializado correctamente');
    }

    // ========== PRE-GENERACION DE RESPUESTAS COMUNES ==========
    async preGenerateCommonResponses() {
        const responses = {
            'confirmar_hora': '¿A que hora te quedaria bien visitarnos?',
            'confirmar_dia': '¿Que dia te acomoda mejor para la visita?',
            'cita_agendada': 'Perfecto, te agendo. Te esperamos en PortoBlanco.',
            'despedida_negativa': 'Entendido, gracias por tu tiempo. Que tengas excelente dia.',
            'si_manana': 'Perfecto, manana entonces. ¿A que hora te queda bien?',
            'si_lunes': 'Perfecto, el lunes entonces. ¿A que hora te queda bien?',
            'si_martes': 'Perfecto, el martes entonces. ¿A que hora te queda bien?',
            'si_miercoles': 'Perfecto, el miercoles entonces. ¿A que hora te queda bien?',
            'si_jueves': 'Perfecto, el jueves entonces. ¿A que hora te queda bien?',
            'si_viernes': 'Perfecto, el viernes entonces. ¿A que hora te queda bien?',
            'si_sabado': 'Perfecto, el sabado entonces. ¿A que hora te queda bien?',
            'pedir_repetir': 'Disculpa, no te escuche bien. ¿Podrias repetirme?',
            'mas_info': 'Con gusto te cuento mas. ¿Que te gustaria saber del desarrollo?',
            'ubicacion': 'PortoBlanco esta ubicado en una zona privilegiada. ¿Te gustaria agendar una visita para conocerlo?'
        };

        const soundsPath = '/usr/share/asterisk/sounds/custom';

        console.log('[CampaignManager] Pre-generando respuestas comunes...');

        for (const [key, text] of Object.entries(responses)) {
            const pcmPath = `/tmp/common_${key}.pcm`;
            const wavPath = `${soundsPath}/common_${key}.wav`;

            try {
                await openaiVoice.textToSpeech(text, pcmPath);
                await audioHandler.convertForAsteriskPlaybackDirect(pcmPath, wavPath);
                this.commonResponses.set(key, `custom/common_${key}`);
                console.log(`  [OK] ${key}`);
            } catch (e) {
                console.error(`  [ERROR] ${key}: ${e.message}`);
            }
        }

        console.log(`[CampaignManager] ${this.commonResponses.size} respuestas pre-generadas`);
    }

    // Detectar si la respuesta del cliente coincide con una comun
    detectCommonResponse(clientText) {
        const text = clientText.toLowerCase();

        // Dias de la semana
        if (/\bmanana\b/i.test(text)) return 'si_manana';
        if (/\blunes\b/i.test(text)) return 'si_lunes';
        if (/\bmartes\b/i.test(text)) return 'si_martes';
        if (/\bmiercoles\b/i.test(text)) return 'si_miercoles';
        if (/\bjueves\b/i.test(text)) return 'si_jueves';
        if (/\bviernes\b/i.test(text)) return 'si_viernes';
        if (/\bsabado\b/i.test(text)) return 'si_sabado';

        // Hora mencionada = cita confirmada
        if (/\b(\d{1,2})\s*(am|pm|de la manana|de la tarde)\b/i.test(text)) return 'cita_agendada';
        if (/\ba las\s+\d{1,2}\b/i.test(text)) return 'cita_agendada';

        // Respuestas negativas
        if (/\b(no gracias|no me interesa|no puedo|estoy ocupado)\b/i.test(text)) return 'despedida_negativa';

        // Solicitud de informacion
        if (/\b(donde esta|ubicacion|donde queda)\b/i.test(text)) return 'ubicacion';
        if (/\b(mas informacion|cuentame mas|que ofrecen)\b/i.test(text)) return 'mas_info';

        return null;
    }

    // ========== GESTION DE CAMPANAS ==========
    async startCampaign(campaignId) {
        const campaign = await voicebotDB.getCampaign(campaignId);
        if (!campaign) {
            console.error(`[CampaignManager] Campana ${campaignId} no encontrada`);
            return { success: false, error: 'Campana no encontrada' };
        }

        if (campaign.status === 'running') {
            return { success: false, error: 'Campana ya esta corriendo' };
        }

        await voicebotDB.updateCampaignStatus(campaignId, 'running');
        this.activeCampaigns.set(campaignId, { id: campaignId, status: 'running' });

        console.log(`[CampaignManager] Campana ${campaignId} iniciada`);
        this.processCallQueue(campaignId);

        return { success: true };
    }

    async processCallQueue(campaignId) {
        const campaign = this.activeCampaigns.get(campaignId);
        if (!campaign || campaign.status !== 'running') return;

        // Verificar limite de llamadas concurrentes
        if (this.activeCallsCount >= this.maxConcurrentCalls) {
            setTimeout(() => this.processCallQueue(campaignId), 5000);
            return;
        }

        // Obtener siguiente contacto pendiente
        const pendingContacts = await voicebotDB.getPendingContacts(campaignId, 1);
        if (pendingContacts.length === 0) {
            console.log(`[CampaignManager] Campana ${campaignId} completada - sin contactos pendientes`);
            await this.stopCampaign(campaignId);
            return;
        }

        await this.makeCall(pendingContacts[0]);
        setTimeout(() => this.processCallQueue(campaignId), 2000);
    }

    async makeCall(contact) {
        console.log(`[CampaignManager] Llamando a ${contact.client_name} (${contact.phone_number})`);

        await voicebotDB.updateContactStatus(contact.id, 'calling');
        this.activeCallsCount++;

        try {
            await ariManager.originateCall(contact.phone_number, 'voicebot-ari');

            this.callHandlers.set(contact.phone_number, {
                contact: contact,
                startTime: new Date(),
                answered: false
            });

            // Timeout de 45 segundos si no contestan
            setTimeout(() => {
                const handler = this.callHandlers.get(contact.phone_number);
                if (handler && !handler.answered) {
                    this.handleCallTimeout(contact.phone_number);
                }
            }, 45000);

        } catch (error) {
            console.error(`[CampaignManager] Error originando llamada: ${error.message}`);
            await voicebotDB.updateContactStatus(contact.id, 'failed');
            this.activeCallsCount--;
        }
    }

    async handleCallTimeout(phoneNumber) {
        const handler = this.callHandlers.get(phoneNumber);
        if (!handler) return;

        console.log(`[CampaignManager] Timeout - ${handler.contact.client_name} no contesto`);
        await voicebotDB.updateContactStatus(handler.contact.id, 'no_answer');
        this.callHandlers.delete(phoneNumber);
        this.activeCallsCount--;
    }

    // ========== MANEJO DE LLAMADA CONTESTADA ==========
    async handleCallAnswered(callData) {
        const { channelId, bridgeId, phoneNumber } = callData;
        const handler = this.callHandlers.get(phoneNumber);

        if (!handler) {
            console.log(`[CampaignManager] Llamada contestada sin handler: ${phoneNumber}`);
            this.activeCallsCount--;
            await ariManager.hangup(channelId);
            return;
        }

        handler.answered = true;
        const contact = handler.contact;

        console.log(`[CampaignManager] Llamada contestada: ${contact.client_name}`);

        // Crear registro de llamada en BD
        const dbCallId = await voicebotDB.createCall({
            contactId: contact.id,
            campaignId: contact.campaign_id,
            phoneNumber: contact.phone_number,
            channel: channelId
        });

        await voicebotDB.updateContactStatus(contact.id, 'in_call');

        try {
            // Iniciar conversacion
            await this.handleConversation(channelId, bridgeId, contact, dbCallId);
        } catch (error) {
            console.error(`[CampaignManager] Error en conversacion: ${error.message}`);
        }

        // Colgar y limpiar
        try {
            await ariManager.hangup(channelId);
        } catch (e) {}

        await voicebotDB.updateContactStatus(contact.id, 'completed');
        await voicebotDB.updateCallStatus(dbCallId, 'completed', new Date());
        this.callHandlers.delete(phoneNumber);
        this.activeCallsCount--;
    }

    // ========== FLUJO DE CONVERSACION ==========
    async handleConversation(channelId, bridgeId, contact, callId) {
        const conversationId = `call_${callId}`;
        let turnCount = 0;
        const maxTurns = parseInt(process.env.VOICEBOT_MAX_TURNS) || 8;
        const startTime = Date.now();
        const maxDuration = (parseInt(process.env.VOICEBOT_MAX_CALL_DURATION) || 300) * 1000;

        const context = {
            clientName: contact.client_name,
            propertyType: contact.property_type || contact.product_type,
            propertyLocation: contact.property_location || contact.product_location,
            propertyPrice: contact.property_price || contact.product_price,
            propertySize: contact.property_size
        };

        try {
            // 1. SALUDO INICIAL
            const greeting = `Hola ${contact.client_name || ''}, te llamo de PortoBlanco, desarrollo inmobiliario. Tenemos una propiedad que podria interesarte. ¿Tienes un momento?`;

            // Pre-generar pitch EN PARALELO con el saludo
            const pitchPromise = this.preGeneratePitch(contact, callId);

            await this.speakToClient(bridgeId, greeting, callId, turnCount++, conversationId);
            openaiVoice.addToConversationHistory(conversationId, 'assistant', greeting);

            // Guardar transcripcion del saludo
            await voicebotDB.addTranscription({
                callId,
                sequence: 0,
                speaker: 'bot',
                text: greeting
            });

            let preCachedPitch = null;
            try {
                preCachedPitch = await pitchPromise;
            } catch (e) {
                console.log('[CampaignManager] Pre-generacion de pitch fallo, se generara en tiempo real');
            }

            // 2. CICLO DE CONVERSACION
            let isFirstResponse = true;

            while (turnCount < maxTurns) {
                // Verificar timeout
                if ((Date.now() - startTime) > maxDuration) {
                    console.log('[CampaignManager] Timeout de llamada alcanzado');
                    break;
                }

                // GRABAR RESPUESTA DEL CLIENTE
                const recordingName = `client_${callId}_${turnCount}`;
                const recordedPath = await ariManager.recordAudioFromBridge(bridgeId, recordingName, 3);

                if (!recordedPath) {
                    console.log('[CampaignManager] No se pudo grabar audio');
                    break;
                }

                // Verificar si hay voz
                const hasVoice = await audioHandler.hasVoiceActivity(recordedPath, 0.01);
                if (!hasVoice) {
                    await this.playCommonResponse(bridgeId, 'pedir_repetir');
                    continue;
                }

                // TRANSCRIBIR CON WHISPER
                let transcription;
                try {
                    transcription = await openaiVoice.transcribeAudio(recordedPath);
                } catch (e) {
                    console.error('[CampaignManager] Error en transcripcion:', e.message);
                    await this.playCommonResponse(bridgeId, 'pedir_repetir');
                    continue;
                }

                if (!transcription?.text?.trim()) {
                    await this.playCommonResponse(bridgeId, 'pedir_repetir');
                    continue;
                }

                console.log(`[Cliente] "${transcription.text}"`);

                // Guardar transcripcion del cliente
                await voicebotDB.addTranscription({
                    callId,
                    sequence: turnCount,
                    speaker: 'client',
                    text: transcription.text
                });

                openaiVoice.addToConversationHistory(conversationId, 'user', transcription.text);

                // PRIMERA RESPUESTA: USAR AUDIO PRE-CACHEADO SI ES POSITIVA
                if (isFirstResponse && preCachedPitch) {
                    isFirstResponse = false;
                    const isPositive = /\b(si|sí|claro|ok|dale|bueno|dime|adelante)\b/i.test(transcription.text);
                    const isNegative = /\b(no|ocupado|despues|luego|no puedo|no gracias)\b/i.test(transcription.text);

                    if (isPositive) {
                        // Reproducir pitch pre-generado (SIN GPT, SIN TTS = latencia minima)
                        await ariManager.playAudio(bridgeId, `custom/pitch_${callId}`);
                        openaiVoice.addToConversationHistory(conversationId, 'assistant', preCachedPitch.text);

                        await voicebotDB.addTranscription({
                            callId,
                            sequence: turnCount,
                            speaker: 'bot',
                            text: preCachedPitch.text
                        });

                        turnCount++;
                        continue;
                    } else if (isNegative) {
                        await this.playCommonResponse(bridgeId, 'despedida_negativa');
                        break;
                    }
                }
                isFirstResponse = false;

                // DETECTAR RESPUESTAS COMUNES (instantaneas)
                const commonKey = this.detectCommonResponse(transcription.text);
                if (commonKey && this.commonResponses.has(commonKey)) {
                    await ariManager.playAudio(bridgeId, this.commonResponses.get(commonKey));

                    if (commonKey === 'despedida_negativa') break;
                    if (commonKey === 'cita_agendada') {
                        // Marcar que se agendo cita
                        console.log('[CampaignManager] Cita detectada via respuesta comun');
                    }
                    turnCount++;
                    continue;
                }

                // GENERAR RESPUESTA CON GPT
                let aiResponse;
                try {
                    aiResponse = await openaiVoice.generateResponse(
                        transcription.text,
                        conversationId,
                        null,
                        context
                    );
                } catch (e) {
                    console.error('[CampaignManager] Error en GPT:', e.message);
                    await this.speakToClient(bridgeId, 'Disculpa, ¿podrias repetirme?', callId, turnCount++, conversationId);
                    continue;
                }

                console.log(`[Bot] "${aiResponse.text}"`);

                await this.speakToClient(bridgeId, aiResponse.text, callId, turnCount, conversationId);

                // Guardar respuesta del bot
                await voicebotDB.addTranscription({
                    callId,
                    sequence: turnCount,
                    speaker: 'bot',
                    text: aiResponse.text
                });

                turnCount++;

                // Detectar despedida
                if (/gracias por tu tiempo|que tengas (buen|excelente) dia|hasta luego|adios/i.test(aiResponse.text)) {
                    break;
                }
            }

        } catch (error) {
            console.error('[CampaignManager] Error en conversacion:', error);
        } finally {
            // 3. ANALISIS POST-LLAMADA (siempre intentar guardar aunque haya errores)
            try {
                await this.analyzeAndSaveAppointment(conversationId, callId, contact);
            } catch (analysisError) {
                console.error('[CampaignManager] Error guardando cita:', analysisError.message);
            }
            openaiVoice.clearConversationContext(conversationId);
        }
    }

    async speakToClient(bridgeId, text, callId, sequence, conversationId) {
        const soundsPath = '/usr/share/asterisk/sounds/custom';
        const filename = `tts_${callId}_${sequence}_${Date.now()}`;
        const pcmPath = `/tmp/${filename}.pcm`;
        const wavPath = `${soundsPath}/${filename}.wav`;

        try {
            await openaiVoice.textToSpeech(text, pcmPath);
            await audioHandler.convertForAsteriskPlaybackDirect(pcmPath, wavPath);
            await ariManager.playAudio(bridgeId, `custom/${filename}`);
        } catch (error) {
            console.error('[CampaignManager] Error en TTS:', error.message);
        }
    }

    async playCommonResponse(bridgeId, key) {
        if (this.commonResponses.has(key)) {
            await ariManager.playAudio(bridgeId, this.commonResponses.get(key));
        }
    }

    // Convertir número a texto en español (para precios)
    formatPriceToText(price) {
        if (!price) return '';

        // Si ya tiene texto como "millones", devolverlo tal cual
        if (/[a-zA-Z]/.test(price)) return price;

        // Limpiar y convertir a número
        const num = parseInt(String(price).replace(/[^\d]/g, ''));
        if (isNaN(num) || num === 0) return price;

        if (num >= 1000000) {
            const millones = Math.floor(num / 1000000);
            const resto = num % 1000000;
            const miles = Math.floor(resto / 1000);

            let texto = millones === 1 ? '1 millón' : `${millones} millones`;
            if (miles > 0) {
                texto += ` ${miles} mil`;
            }
            return texto + ' pesos';
        } else if (num >= 1000) {
            const miles = Math.floor(num / 1000);
            return `${miles} mil pesos`;
        }
        return `${num} pesos`;
    }

    // Convertir tamaño a texto
    formatSizeToText(size) {
        if (!size) return '';

        // Si ya tiene "metros", devolverlo tal cual
        if (/metro/i.test(size)) return size;

        // Limpiar y convertir
        const num = parseInt(String(size).replace(/[^\d]/g, ''));
        if (isNaN(num) || num === 0) return size;

        return `${num} metros cuadrados`;
    }

    // Formatear tipo de propiedad
    formatPropertyType(type) {
        if (!type) return 'propiedad';

        const lower = type.toLowerCase().trim();

        // Si ya tiene "terreno" o es una frase completa, devolverlo
        if (/terreno|lote|casa|departamento/.test(lower)) return type;

        // Agregar "terreno" si es solo el tipo
        return `terreno ${lower}`;
    }

    async preGeneratePitch(contact, callId) {
        const propertyType = this.formatPropertyType(contact.property_type || contact.product_type);
        const location = contact.property_location || contact.product_location || '';
        const price = this.formatPriceToText(contact.property_price || contact.product_price);
        const size = this.formatSizeToText(contact.property_size);

        let pitchText = `Tenemos ${propertyType}`;
        if (location) pitchText += ` en ${location}`;
        if (size) pitchText += `, de ${size}`;
        if (price) pitchText += `, con precio desde ${price}`;
        pitchText += `. ¿Te gustaria agendar una visita para conocerlo?`;

        const soundsPath = '/usr/share/asterisk/sounds/custom';
        const pcmPath = `/tmp/pitch_${callId}.pcm`;
        const wavPath = `${soundsPath}/pitch_${callId}.wav`;

        await openaiVoice.textToSpeech(pitchText, pcmPath);
        await audioHandler.convertForAsteriskPlaybackDirect(pcmPath, wavPath);

        return { text: pitchText, path: wavPath };
    }

    async analyzeAndSaveAppointment(conversationId, callId, contact) {
        const history = openaiVoice.getConversationContext(conversationId);
        if (history.length === 0) return;

        try {
            const analysis = await openaiVoice.analyzeConversationIntent(history);

            console.log('[CampaignManager] Analisis de conversacion:', analysis);

            if (analysis.wantsAppointment || analysis.agreement ||
                (analysis.appointmentDate && analysis.appointmentTime)) {

                await voicebotDB.createAppointment({
                    callId,
                    contactId: contact.id,
                    campaignId: contact.campaign_id,
                    phoneNumber: contact.phone_number,
                    clientName: contact.client_name,
                    date: analysis.appointmentDate,
                    time: analysis.appointmentTime,
                    interestLevel: analysis.interestLevel,
                    agreementReached: analysis.agreement
                });

                console.log(`[CampaignManager] Cita creada: ${contact.client_name} - ${analysis.appointmentDate} ${analysis.appointmentTime}`);
            }

            // Actualizar nivel de interes del contacto
            await voicebotDB.updateContactInterest(contact.id, analysis.interestLevel);

        } catch (error) {
            console.error('[CampaignManager] Error en analisis:', error.message);
        }
    }

    // ========== CONTROL DE CAMPANAS ==========
    async pauseCampaign(campaignId) {
        await voicebotDB.updateCampaignStatus(campaignId, 'paused');
        const campaign = this.activeCampaigns.get(campaignId);
        if (campaign) campaign.status = 'paused';
        console.log(`[CampaignManager] Campana ${campaignId} pausada`);
        return { success: true };
    }

    async resumeCampaign(campaignId) {
        const campaign = await voicebotDB.getCampaign(campaignId);
        if (!campaign || campaign.status !== 'paused') {
            return { success: false, error: 'Campana no esta pausada' };
        }

        await voicebotDB.updateCampaignStatus(campaignId, 'running');
        this.activeCampaigns.set(campaignId, { id: campaignId, status: 'running' });
        this.processCallQueue(campaignId);

        console.log(`[CampaignManager] Campana ${campaignId} reanudada`);
        return { success: true };
    }

    async stopCampaign(campaignId) {
        await voicebotDB.updateCampaignStatus(campaignId, 'completed');
        this.activeCampaigns.delete(campaignId);
        console.log(`[CampaignManager] Campana ${campaignId} completada`);
        return { success: true };
    }

    getStatus() {
        return {
            activeCallsCount: this.activeCallsCount,
            maxConcurrentCalls: this.maxConcurrentCalls,
            activeCampaigns: Array.from(this.activeCampaigns.values()),
            commonResponsesLoaded: this.commonResponses.size,
            asteriskConnected: ariManager.isConnected ? ariManager.isConnected() : false
        };
    }

    getActiveCampaigns() {
        return Array.from(this.activeCampaigns.values());
    }
}

module.exports = new CampaignManager();
