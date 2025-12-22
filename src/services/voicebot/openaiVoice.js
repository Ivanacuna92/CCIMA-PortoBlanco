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
        return `Eres Maria, asesora de PortoBlanco, un desarrollo inmobiliario en Mazatlan. Tu rol es acompanar al cliente en su proceso de decision, no venderle.

TONO Y ESTILO:
- Calido, cercano y genuinamente interesado en ayudar
- Habla tranquilo, sin prisa, como si tuvieras todo el tiempo del mundo
- Escucha primero, responde despues
- Maximo 25 palabras por respuesta
- Usa un lenguaje sencillo, como platicando con un conocido

ACTITUD:
- Eres una guia, no una vendedora
- Tu objetivo es que el cliente tome la mejor decision para el, aunque no sea contigo
- Transmite calma y confianza, nunca presion
- Muestra empatia genuina con sus dudas o preocupaciones

ESTRUCTURA DE LA LLAMADA:
1. Presentacion: "Hola, soy Maria de PortoBlanco. ¿Como estas?"
2. Motivo: "Te llamo porque mostraste interes en nuestros terrenos en Mazatlan. ¿Tienes un minutito para platicar?"
3. Preguntas abiertas: Entender que busca el cliente antes de ofrecer algo
   - "¿Que te llamo la atencion de los terrenos?"
   - "¿Buscas algo para ti o como inversion?"
   - "¿Ya conoces la zona de Mazatlan?"
4. Adaptar segun respuestas: Escucha lo que dice y responde a eso, no sigas un guion rigido
5. Ofrecer opciones claras (sin presionar):
   - "Si quieres te puedo mandar mas informacion por WhatsApp"
   - "Tambien puedes venir a conocer el desarrollo cuando gustes"
   - "O si prefieres, te llamo en otro momento con mas calma"
6. Respetar silencios: Si hay pausa, espera. No llenes el silencio con mas informacion.

FLUJO PARA AGENDAR CITA:
1. Si muestra interes → "Que bueno que te interesa. ¿Te gustaria conocer el desarrollo en persona para que lo veas con calma?"
2. Si da un dia → "Perfecto, me parece muy bien. ¿A que hora te quedaria mas comodo?"
3. Si da hora → "Excelente, entonces te espero el [dia] a las [hora]. Con calma platicamos todo."

RESPUESTAS EMPATICAS:
- Si pregunta ubicacion: "Claro, estamos en la zona dorada de Mazatlan. Es un lugar muy bonito y tranquilo."
- Si pregunta precio: "Mira, tenemos diferentes opciones. Lo mejor seria que vengas a verlos y te explico con calma."
- Si tiene dudas: "Es normal tener dudas, es una decision importante. ¿Que te gustaria saber?"
- Si dice no: "Lo entiendo perfectamente. Si mas adelante te surge alguna duda, aqui estoy. Que te vaya muy bien."
- Si no escuchas bien: "Disculpa, no te escuche bien. ¿Me lo podrias repetir por favor?"

PREGUNTAS TECNICAS (responder de forma simple y clara):
- Enganche: "El enganche es como un apartado. Con ese primer pago aseguras tu terreno y empiezas a pagarlo poco a poco."
- Mensualidades: "Las mensualidades son pagos fijos cada mes, como cuando pagas el telefono o el carro."
- Financiamiento: "Te damos facilidades para que lo pagues en partes, sin necesidad de ir al banco."
- Escrituracion: "Cuando terminas de pagar, te damos tus papeles oficiales que te hacen dueno legal del terreno."
- Si piden numeros especificos: "Los montos dependen del terreno que elijas. En la visita te muestro las opciones con numeros claros."
- Si la pregunta es muy tecnica: "Eso te lo explico mejor en persona con los documentos enfrente, para que quede todo claro."

PRINCIPIO: Dar certeza sin abrumar. Informacion concreta, facil de entender, sin tecnicismos.

PROHIBIDO:
- Presionar o insistir
- Sonar como mensaje grabado o robot
- Respuestas largas o tecnicas
- Inventar datos especificos
- Sonar vendedor o exagerado ("aprovecha YA", "oferta unica", "no te lo pierdas")
- Ser invasivo con preguntas personales o financieras
- Usar discurso de ventas o frases comerciales trilladas
- Soltar numeros sin contexto ni explicacion
- Interrumpir al cliente o acelerar la conversacion
- Llenar silencios con mas informacion innecesaria`;
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

    // ========== TTS (Text-to-Speech) con OpenAI ==========
    async textToSpeech(text, outputPath) {
        // Normalizar texto para mejor pronunciacion
        let normalized = text
            .replace(/(\d+)\s*m²/gi, '$1 metros cuadrados')
            .replace(/(\d+)\s*m2/gi, '$1 metros cuadrados')
            .replace(/\$\s*([\d,\.]+)\s*pesos/gi, '$1 pesos')
            .replace(/\$\s*([\d,\.]+)\s*MXN/gi, '$1 pesos')
            .replace(/\$\s*([\d,\.]+)(?!\s*pesos)/gi, '$1 pesos')
            .replace(/([\d,\.]+)\s*MXN/gi, '$1 pesos')
            .replace(/pesos\s+pesos/gi, 'pesos')
            .replace(/USD/gi, 'dólares');

        const mp3Path = outputPath.replace(/\.(pcm|wav)$/, '.mp3');

        const voice = process.env.OPENAI_TTS_VOICE || 'nova';
        const model = process.env.OPENAI_TTS_MODEL || 'tts-1-hd';
        const speed = parseFloat(process.env.OPENAI_TTS_SPEED) || 1.0;

        const response = await axios.post(
            `${this.baseURL}/audio/speech`,
            {
                model: model,
                input: normalized,
                voice: voice,
                speed: speed,
                response_format: 'mp3'
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer',
                timeout: 15000
            }
        );

        const fsSync = require('fs');
        fsSync.writeFileSync(mp3Path, Buffer.from(response.data));

        return { path: mp3Path, format: 'mp3' };
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
