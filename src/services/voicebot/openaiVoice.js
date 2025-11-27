const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');
require('dotenv').config();

class OpenAIVoiceService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY;
        this.baseURL = 'https://api.openai.com/v1';
        this.conversationContexts = new Map();
    }

    // ========== WHISPER (Speech-to-Text) ==========
    async transcribeAudio(audioFilePath) {
        const formData = new FormData();
        const audioBuffer = await fs.readFile(audioFilePath);

        formData.append('file', audioBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
        formData.append('model', 'whisper-1');
        formData.append('language', process.env.OPENAI_WHISPER_LANGUAGE || 'es');
        formData.append('prompt', 'Llamada telefonica de ventas inmobiliarias. Cliente responde con: si, no, me interesa, manana, el lunes, a las diez, cuanto cuesta.');

        const response = await axios.post(
            `${this.baseURL}/audio/transcriptions`,
            formData,
            {
                headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${this.apiKey}` },
                timeout: 6000
            }
        );

        let text = response.data.text || '';

        // Filtrar alucinaciones conocidas de Whisper
        const hallucinations = [
            'suscribete', 'gracias por ver', 'nos vemos', '♪', '[musica]',
            'like', 'subscribe', 'thanks for watching', 'see you next time'
        ];
        if (hallucinations.some(h => text.toLowerCase().includes(h))) {
            text = '';
        }

        return { text, language: response.data.language };
    }

    // ========== GPT (Generacion de respuestas) ==========
    async generateResponse(userMessage, conversationId, systemPrompt = null, context = null) {
        let history = this.conversationContexts.get(conversationId) || [];

        let finalPrompt = systemPrompt || this.getDefaultSystemPrompt();
        if (context) {
            finalPrompt += this.formatContext(context);
        }

        const messages = [
            { role: 'system', content: finalPrompt },
            ...history,
            { role: 'user', content: userMessage }
        ];

        const response = await axios.post(
            `${this.baseURL}/chat/completions`,
            {
                model: process.env.OPENAI_GPT_MODEL_FAST || 'gpt-4o-mini',
                messages: messages,
                temperature: parseFloat(process.env.OPENAI_GPT_TEMPERATURE) || 0.6,
                max_tokens: 120,
                presence_penalty: 0.5,
                frequency_penalty: 0.3
            },
            {
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                timeout: 5000
            }
        );

        const assistantMessage = response.data.choices[0].message.content;

        // Actualizar historial (max 10 mensajes)
        history.push({ role: 'user', content: userMessage });
        history.push({ role: 'assistant', content: assistantMessage });
        if (history.length > 10) history = history.slice(-10);
        this.conversationContexts.set(conversationId, history);

        return { text: assistantMessage, tokensUsed: response.data.usage.total_tokens };
    }

    getDefaultSystemPrompt() {
        return `Eres un asesor de ventas de PortoBlanco, desarrollo inmobiliario premium.

REGLA #1: Respuestas MAXIMO 25 palabras. Se breve y directo.

FLUJO PARA AGENDAR CITA:
1. Cliente interesado → Pregunta: "¿Que dia te queda bien para visitarnos?"
2. Cliente da dia → Pregunta: "¿A que hora te acomoda?"
3. Cliente da hora → Confirma: "Perfecto, te agendo el [dia] a las [hora]. Te esperamos."

Si dice NO → "Gracias por tu tiempo, que tengas excelente dia."

PROHIBIDO:
- Confirmar cita sin tener dia Y hora
- Respuestas largas
- Repetir informacion
- Inventar precios o datos`;
    }

    formatContext(context) {
        let str = '\n\n=== DATOS DEL CLIENTE/PROPIEDAD ===\n';
        if (context.clientName) str += `Cliente: ${context.clientName}\n`;
        if (context.propertyType) str += `Tipo: ${context.propertyType}\n`;
        if (context.propertyLocation) str += `Ubicacion: ${context.propertyLocation}\n`;
        if (context.propertyPrice) str += `Precio: ${context.propertyPrice}\n`;
        if (context.propertySize) str += `Tamano: ${context.propertySize}\n`;
        return str;
    }

    // ========== TTS (Text-to-Speech) ==========
    async textToSpeech(text, outputPath) {
        // Normalizar texto para mejor pronunciacion
        let normalized = text
            // Metros cuadrados
            .replace(/(\d+)\s*m²/gi, '$1 metros cuadrados')
            .replace(/(\d+)\s*m2/gi, '$1 metros cuadrados')
            // Precios - evitar duplicar "pesos"
            .replace(/\$\s*([\d,\.]+)\s*pesos/gi, '$1 pesos')  // $3,500,000 pesos → 3,500,000 pesos
            .replace(/\$\s*([\d,\.]+)\s*MXN/gi, '$1 pesos')    // $3,500,000 MXN → 3,500,000 pesos
            .replace(/\$\s*([\d,\.]+)(?!\s*pesos)/gi, '$1 pesos') // $3,500,000 → 3,500,000 pesos (solo si no tiene pesos después)
            .replace(/([\d,\.]+)\s*MXN/gi, '$1 pesos')         // 3,500,000 MXN → 3,500,000 pesos
            .replace(/pesos\s+pesos/gi, 'pesos')              // Limpiar duplicados
            .replace(/USD/gi, 'dólares');

        const response = await axios.post(
            `${this.baseURL}/audio/speech`,
            {
                model: process.env.OPENAI_TTS_MODEL || 'tts-1',
                input: normalized,
                voice: process.env.OPENAI_TTS_VOICE || 'nova',
                response_format: 'pcm',
                speed: parseFloat(process.env.OPENAI_TTS_SPEED) || 0.95
            },
            {
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                responseType: 'arraybuffer',
                timeout: 6000
            }
        );

        const pcmPath = outputPath.replace(/\.(mp3|wav)$/, '.pcm');
        await fs.writeFile(pcmPath, response.data);
        return { path: pcmPath, format: 'pcm' };
    }

    // ========== ANALISIS POST-LLAMADA ==========
    async analyzeConversationIntent(conversationHistory) {
        const today = new Date().toISOString().split('T')[0];

        const prompt = `Analiza esta conversacion telefonica y detecta si se agendo una cita.

FECHA DE HOY: ${today}

CONVERSACION:
${conversationHistory.map(m => `${m.role === 'user' ? 'CLIENTE' : 'ASESOR'}: ${m.content}`).join('\n')}

Responde SOLO en JSON:
{
  "interest": true/false,
  "agreement": true/false,
  "wantsAppointment": true/false,
  "appointmentDate": "YYYY-MM-DD o null",
  "appointmentTime": "HH:MM o null",
  "interestLevel": "high/medium/low/none",
  "clientResponse": "positivo/negativo/indeciso"
}`;

        const response = await axios.post(
            `${this.baseURL}/chat/completions`,
            {
                model: process.env.OPENAI_GPT_MODEL || 'gpt-4o',
                messages: [
                    { role: 'system', content: 'Analizador de conversaciones de ventas inmobiliarias. Responde solo en JSON valido.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2,
                response_format: { type: 'json_object' }
            },
            { headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' } }
        );

        return JSON.parse(response.data.choices[0].message.content);
    }

    // ========== FLUJO COMPLETO: Audio entrada → Audio salida ==========
    async processVoiceInput(audioFilePath, conversationId, systemPrompt = null, context = null) {
        // 1. Transcribir audio del cliente
        const transcription = await this.transcribeAudio(audioFilePath);

        if (!transcription.text || transcription.text.trim() === '') {
            return {
                transcription: '',
                response: 'No te escuche bien, ¿podrias repetir?',
                audioPath: null
            };
        }

        // 2. Generar respuesta con GPT
        const gptResponse = await this.generateResponse(
            transcription.text,
            conversationId,
            systemPrompt,
            context
        );

        // 3. Convertir respuesta a audio
        const outputPath = `/tmp/tts_${conversationId}_${Date.now()}.pcm`;
        const ttsResult = await this.textToSpeech(gptResponse.text, outputPath);

        return {
            transcription: transcription.text,
            response: gptResponse.text,
            audioPath: ttsResult.path,
            tokensUsed: gptResponse.tokensUsed
        };
    }

    addToConversationHistory(conversationId, role, content) {
        let history = this.conversationContexts.get(conversationId) || [];
        history.push({ role, content });
        this.conversationContexts.set(conversationId, history);
    }

    getConversationContext(conversationId) {
        return this.conversationContexts.get(conversationId) || [];
    }

    clearConversationContext(conversationId) {
        this.conversationContexts.delete(conversationId);
    }
}

module.exports = new OpenAIVoiceService();
