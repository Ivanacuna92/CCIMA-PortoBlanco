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
                content: `Analiza esta conversación y determina si se cumple alguna de estas condiciones:

1. ACEPTADO: El cliente mostró intención clara de proceder (pidió cita, proporcionó correo, confirmó interés explícito, dijo que quiere avanzar)
2. RECHAZADO: El cliente rechazó explícitamente la oferta (dijo "no me interesa", "no gracias", "no es para mí", "no quiero")
3. FRUSTRADO: El cliente muestra frustración o enojo (usa lenguaje negativo fuerte, se queja de insistencia, pide que dejen de contactarlo, muestra molestia clara)
4. ACTIVO: La conversación sigue activa y productiva (hace preguntas, responde con interés, pide información)
5. INACTIVO: El cliente dejó de responder sin señales claras

IMPORTANTE: Sé conservador con FRUSTRADO - solo úsalo si hay señales MUY claras de enojo o molestia explícita.

Responde ÚNICAMENTE con una de estas palabras: ACEPTADO, RECHAZADO, FRUSTRADO, ACTIVO, o INACTIVO`
            };

            const userPrompt = {
                role: 'user',
                content: `Último mensaje del cliente: "${lastMessage}"\n\nAnaliza el estado de la conversación.`
            };

            const aiMessages = [analysisPrompt, ...messages, userPrompt];
            const response = await this.generateResponse(aiMessages);

            return response.trim().toUpperCase();
        } catch (error) {
            console.error('Error analizando estado de conversación:', error);
            return 'ACTIVO'; // Default a activo en caso de error
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