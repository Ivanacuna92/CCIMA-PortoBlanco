const axios = require('axios');
const config = require('../config/config');
const csvService = require('./csvService');

class AIService {
    constructor() {
        this.apiKey = config.deepseekApiKey;
        this.apiUrl = config.deepseekApiUrl;
    }

    async generateResponse(messages) {
        try {
            // Incluir datos de CSV en el prompt del sistema
            const enrichedMessages = await this.addCSVDataToSystemPrompt(messages);

            const response = await axios.post(this.apiUrl, {
                model: 'deepseek-chat',
                messages: enrichedMessages,
                max_tokens: 1000,
                temperature: 0.5
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('Error con DeepSeek API:', error.response?.data || error.message);

            if (error.response?.data?.error?.type === 'authentication_error') {
                throw new Error('Error de autenticación con API key');
            }

            throw new Error('Error generando respuesta de IA');
        }
    }

    async analyzeConversationStatus(messages, lastMessage) {
        try {
            const analysisPrompt = {
                role: 'system',
                content: `Analiza esta conversación y determina el estado del cliente. Responde ÚNICAMENTE con una palabra.

RECHAZADO - El cliente NO quiere continuar. Detecta estas señales:
- Rechazos directos: "no me interesa", "no gracias", "no quiero", "no es para mí"
- Peticiones de parar: "ya no me escriban", "dejen de mandarme mensajes", "no me contacten", "basta", "ya estuvo", "párenle"
- Negativas claras: "no estoy interesado", "ya no", "nel", "nop", "para nada", "olvídalo", "déjalo así"
- Rechazo educado: "gracias pero no", "por el momento no", "ahorita no puedo", "no es buen momento"
- Cualquier variación que indique que NO quiere seguir recibiendo información

FRUSTRADO - El cliente está MOLESTO (solo si hay señales claras de enojo):
- Quejas de insistencia: "ya les dije que no", "dejen de molestar", "qué necio", "ya me hartaron"
- Lenguaje agresivo o groserías
- Amenazas de bloquear o reportar

ACEPTADO - El cliente quiere PROCEDER:
- Pide cita, da su correo, confirma interés explícito, quiere avanzar con la compra

ACTIVO - La conversación sigue PRODUCTIVA:
- Hace preguntas, muestra interés, pide más información

INACTIVO - Sin señales claras (respuestas ambiguas o muy cortas sin contexto)

IMPORTANTE: Ante la DUDA entre RECHAZADO y ACTIVO, prefiere RECHAZADO si hay cualquier indicio de desinterés. Es mejor dejar de contactar a un cliente que podría estar interesado que molestar a uno que no lo está.

Responde ÚNICAMENTE: ACEPTADO, RECHAZADO, FRUSTRADO, ACTIVO o INACTIVO`
            };

            const userPrompt = {
                role: 'user',
                content: `Último mensaje del cliente: "${lastMessage}"\n\nAnaliza el estado de la conversación.`
            };

            const aiMessages = [analysisPrompt, ...messages, userPrompt];
            const response = await this.generateResponse(aiMessages);

            const status = response.trim().toUpperCase();
            console.log(`[AnalyzeStatus] Mensaje: "${lastMessage.substring(0, 50)}..." -> Estado: ${status}`);

            return status;
        } catch (error) {
            console.error('Error analizando estado de conversación:', error);
            console.log('[AnalyzeStatus] Error en análisis, usando INACTIVO por seguridad');
            return 'INACTIVO'; // Cambiado: mejor no molestar en caso de error
        }
    }

    async addCSVDataToSystemPrompt(messages) {
        try {
            // Obtener todos los datos de CSV
            const allRecords = await csvService.getAllRecords();
            
            if (allRecords.length === 0) {
                return messages;
            }
            
            // Formatear todos los registros
            const csvData = allRecords.map(record => 
                csvService.formatRecordForDisplay(record)
            ).join('\n\n---\n\n');
            
            // Agregar CSV data al mensaje del sistema
            const enrichedMessages = [...messages];
            const systemMessage = enrichedMessages.find(m => m.role === 'system');
            
            if (systemMessage) {
                systemMessage.content = systemMessage.content + `\n\n*BASE DE DATOS DE TERRENOS DISPONIBLES:*\n\n${csvData}\n\nUsa esta información cuando el usuario pregunte sobre terrenos, ubicaciones, precios, metrajes disponibles, plusvalía o cualquier tema relacionado. Si el usuario pregunta por algo específico que está en esta base de datos, úsala para responder de manera precisa y actualizada.`;
            }
            
            return enrichedMessages;
        } catch (error) {
            console.error('Error agregando datos CSV al prompt:', error);
            return messages;
        }
    }
}

module.exports = new AIService();