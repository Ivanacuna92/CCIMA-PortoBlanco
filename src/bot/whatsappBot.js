const makeWASocket = require("baileys").default;
const {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} = require("baileys");

// makeInMemoryStore is optional in some Baileys versions
let makeInMemoryStore;
try {
  makeInMemoryStore = require("baileys").makeInMemoryStore;
} catch (e) {
  console.log("makeInMemoryStore not available in this Baileys version");
}
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const config = require("../config/config");
const logger = require("../services/logger");
const aiService = require("../services/aiService");
const sessionManager = require("../services/sessionManager");
const promptLoader = require("../services/promptLoader");
const humanModeManager = require("../services/humanModeManager");
const conversationAnalyzer = require("../services/conversationAnalyzer");
const userDataManager = require("../services/userDataManager");
const followUpManager = require("../services/followUpManager");

class WhatsAppBot {
  constructor() {
    this.sock = null;
    this.systemPrompt = promptLoader.getPrompt();
    this.store = null;
    this.currentQR = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.isReconnecting = false;
  }

  async start() {
    if (this.isReconnecting) {
      console.log("Ya hay un intento de reconexión en progreso...");
      return;
    }

    this.isReconnecting = true;
    console.log("Iniciando bot de WhatsApp con Baileys...");
    config.validateApiKey();

    try {
      // Configurar autenticación multi-archivo
      const { state, saveCreds } = await useMultiFileAuthState(
        "./auth_baileys"
      );

      // Obtener versión más reciente de Baileys
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(
        `Usando versión de WhatsApp Web: ${version.join(
          "."
        )} (última: ${isLatest})`
      );

      // Crear store en memoria para manejar mensajes (si está disponible)
      if (makeInMemoryStore) {
        this.store = makeInMemoryStore({
          logger: pino({ level: "silent" }),
        });
      } else {
        console.log("Continuando sin makeInMemoryStore");
        this.store = null;
      }

      // Crear socket de WhatsApp con configuración mejorada para VPS
      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: "silent" })
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Chrome (Linux)", "", ""],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        getMessage: async (key) => {
          if (this.store) {
            const msg = await this.store.loadMessage(key.remoteJid, key.id);
            return msg?.message || undefined;
          }
          return { conversation: "No disponible" };
        },
        defaultQueryTimeoutMs: undefined,
        // Timeouts más largos para VPS con conexión variable
        connectTimeoutMs: 120000, // 2 minutos
        keepAliveIntervalMs: 45000, // 45 segundos
        qrTimeout: 60000, // 1 minuto para QR
        markOnlineOnConnect: false,
        msgRetryCounterCache: new Map(),
        retryRequestDelayMs: 500, // Mayor delay entre reintentos
        maxMsgRetryCount: 3, // Menos reintentos para evitar loops
        // Opciones adicionales para estabilidad en VPS
        shouldIgnoreJid: (jid) => false,
        cachedGroupMetadata: async (jid) => null,
        transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
      });

      // Vincular store al socket
      if (this.store) {
        this.store.bind(this.sock.ev);
      }

      // Guardar credenciales cuando se actualicen
      this.sock.ev.on("creds.update", saveCreds);

      // Manejar actualizaciones de conexión
      this.sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log("Escanea este código QR con WhatsApp:");
          console.log("O visita: http://tu-servidor:4242/qr");
          this.currentQR = qr;
          qrcode.generate(qr, { small: true });
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          const errorMessage = lastDisconnect?.error?.message || "desconocido";

          console.log(
            `⚠️  Conexión cerrada - Código: ${statusCode}, Error: ${errorMessage}, Reconectar: ${shouldReconnect}`
          );

          // Manejo específico del error 515 (Stream Error) - común en VPS
          if (statusCode === 515) {
            this.reconnectAttempts++;
            console.log(
              `🔄 Error 515 (Stream Error) detectado. Intento ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
            );

            if (this.reconnectAttempts > this.maxReconnectAttempts) {
              console.log(
                "❌ Máximo de intentos de reconexión alcanzado para error 515."
              );
              console.log("   Posibles causas:");
              console.log("   - Conexión de red inestable en el VPS");
              console.log("   - Firewall bloqueando WebSockets");
              console.log("   - Recursos insuficientes (RAM/CPU)");
              console.log("   Por favor, reinicia la sesión en /qr");
              this.isReconnecting = false;
              return;
            }

            // Para error 515, esperar más tiempo antes de reconectar
            const retryDelay = 10000 + (this.reconnectAttempts * 5000); // 10s, 15s, 20s
            console.log(`   Esperando ${retryDelay / 1000}s antes de reintentar...`);
            this.isReconnecting = false;
            setTimeout(() => this.start(), retryDelay);
            return;
          }

          // Si es error 405, 401 o 403, limpiar sesión y reiniciar con límite
          if (statusCode === 405 || statusCode === 401 || statusCode === 403) {
            this.reconnectAttempts++;

            if (this.reconnectAttempts > this.maxReconnectAttempts) {
              console.log(
                "❌ Máximo de intentos de reconexión alcanzado. Por favor usa el botón de reiniciar sesión en /qr"
              );
              this.isReconnecting = false;
              return;
            }

            console.log(
              `Error ${statusCode} detectado. Intento ${this.reconnectAttempts}/${this.maxReconnectAttempts}. Limpiando sesión...`
            );
            this.clearSession();

            this.isReconnecting = false;
            setTimeout(() => this.start(), 5000);
          } else if (
            shouldReconnect &&
            statusCode !== DisconnectReason.loggedOut
          ) {
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            setTimeout(() => this.start(), 5000);
          } else {
            this.isReconnecting = false;
          }
        } else if (connection === "open") {
          console.log("¡Bot de WhatsApp conectado y listo!");
          this.currentQR = null;
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          logger.log("SYSTEM", "Bot iniciado correctamente con Baileys");

          // Inicializar follow-up manager
          followUpManager.initialize().then(() => {
            followUpManager.startFollowUpTimer(
              this.sock,
              aiService,
              sessionManager
            );
          });

          // Iniciar timer de limpieza de sesiones con referencia al followUpManager
          sessionManager.startCleanupTimer(this.sock, followUpManager);
        }
      });

      // Manejar mensajes entrantes
      this.sock.ev.on("messages.upsert", async (m) => {
        try {
          const msg = m.messages[0];
          if (!msg.message) return;

          // Log para debugging
          console.log(
            "Mensaje recibido - fromMe:",
            msg.key.fromMe,
            "remoteJid:",
            msg.key.remoteJid
          );

          // Ignorar mensajes propios
          if (msg.key.fromMe) {
            console.log("Ignorando mensaje propio");
            return;
          }

          // Obtener el número del remitente
          const from = msg.key.remoteJid;
          const isGroup = from.endsWith("@g.us");

          // Solo responder a mensajes privados
          if (isGroup) return;

          // Obtener el texto del mensaje
          const conversation =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";

          // Ignorar mensajes sin texto
          if (!conversation || conversation.trim() === "") {
            console.log("Mensaje ignorado - Sin contenido de texto");
            return;
          }

          // Extraer información del usuario
          const userId = from.replace("@s.whatsapp.net", "");
          const userName = msg.pushName || userId;

          // Implementar un sistema de debounce para evitar procesamiento duplicado
          if (!this.messageProcessingQueue) {
            this.messageProcessingQueue = new Map();
          }

          // Crear clave única para el mensaje
          const messageKey = `${userId}_${conversation}_${Date.now()}`;

          // Verificar si ya estamos procesando un mensaje similar
          const recentKey = Array.from(this.messageProcessingQueue.keys()).find(
            (key) => {
              const [id, content] = key.split("_");
              return id === userId && content === conversation;
            }
          );

          if (
            recentKey &&
            Date.now() - this.messageProcessingQueue.get(recentKey) < 2000
          ) {
            console.log(`Mensaje duplicado ignorado de ${userId}`);
            return;
          }

          // Marcar mensaje como en procesamiento
          this.messageProcessingQueue.set(messageKey, Date.now());

          // Limpiar mensajes antiguos del queue
          for (const [
            key,
            timestamp,
          ] of this.messageProcessingQueue.entries()) {
            if (Date.now() - timestamp > 5000) {
              this.messageProcessingQueue.delete(key);
            }
          }

          await logger.log("cliente", conversation, userId, userName);

          // Verificar si está en modo humano o soporte
          const isHuman = await humanModeManager.isHumanMode(userId);
          const isSupport = await humanModeManager.isSupportMode(userId);

          if (isHuman || isSupport) {
            const mode = isSupport ? "SOPORTE" : "HUMANO";
            await logger.log(
              "SYSTEM",
              `Mensaje ignorado - Modo ${mode} activo para ${userName} (${userId})`
            );
            this.messageProcessingQueue.delete(messageKey);

            // Detener seguimiento si está activo (ya está en conversación activa)
            if (await followUpManager.isFollowUpActive(userId)) {
              await followUpManager.stopFollowUp(userId, "modo_humano_activo");
            }

            return;
          }

          // Procesar mensaje y generar respuesta
          const response = await this.processMessage(
            userId,
            conversation,
            from
          );

          // Enviar respuesta solo si tenemos una respuesta válida
          if (response && response.trim() !== "") {
            await this.sock.sendMessage(from, { text: response });
            await logger.log("bot", response, userId, userName);
          }

          // Analizar estado de la conversación después de la respuesta
          const conversationHistory = await sessionManager.getMessages(
            userId,
            from
          );
          const status = await aiService.analyzeConversationStatus(
            conversationHistory,
            conversation
          );

          console.log(
            `[FollowUp] Estado de conversación para ${userId}: ${status}`
          );

          // Manejar seguimientos basados en el estado
          if (
            status === "ACEPTADO" ||
            status === "RECHAZADO" ||
            status === "FRUSTRADO"
          ) {
            // Detener seguimiento si existe
            if (await followUpManager.isFollowUpActive(userId)) {
              await followUpManager.stopFollowUp(userId, status.toLowerCase());
            }
          } else if (status === "ACTIVO") {
            // Cliente respondió - detener seguimiento si existe
            if (await followUpManager.isFollowUpActive(userId)) {
              await followUpManager.stopFollowUp(userId, "volvio_activo");
            }
            // NO iniciar seguimiento aquí - se iniciará automáticamente a los 5 minutos por sessionManager
          }
          // NO manejamos INACTIVO aquí - el sessionManager lo hace a los 5 minutos

          // Eliminar del queue después de procesar
          this.messageProcessingQueue.delete(messageKey);
        } catch (error) {
          await this.handleError(error, m.messages[0]);
        }
      });
    } catch (error) {
      console.error("Error iniciando bot:", error);
      this.isReconnecting = false;

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(
          `Reintentando en 5 segundos... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        );
        setTimeout(() => this.start(), 5000);
      }
    }
  }

  async processMessage(userId, userMessage, chatId) {
    const dataCollectionState = userDataManager.getDataCollectionState(userId);
    const trimmedMessage = userMessage.trim();

    // Verificar si estamos esperando el email para activar soporte (prioridad alta)
    if (dataCollectionState === "email_pending_for_support") {
      return await this.handleEmailCollection(userId, userMessage, chatId);
    }

    // Verificar si está esperando nombre después de confirmar interés
    if (dataCollectionState === "waiting_name_after_interest") {
      // Agregar el mensaje del usuario primero
      await sessionManager.addMessage(userId, "user", userMessage, chatId);

      // Si responde afirmativamente, pedir nombre
      if (userDataManager.isAffirmativeResponse(userMessage)) {
        const nameRequestMessage = `Perfecto 🙌🏼
Antes de enviarte la información, ¿podrías compartirme tu *nombre* para personalizar tu asesoría?`;

        await sessionManager.addMessage(
          userId,
          "assistant",
          nameRequestMessage,
          chatId
        );

        // Cambiar el estado para que ahora esté esperando el nombre explícitamente
        await userDataManager.setWaitingForName(userId, true);
        await userDataManager.setWaitingForNameAfterInterest(userId, false);

        return nameRequestMessage;
      } else {
        // Si no responde afirmativamente, continuar con flujo normal de IA
        await userDataManager.setWaitingForNameAfterInterest(userId, false);
        // Continuar procesando con IA más abajo
      }
    }

    // Verificar si está esperando nombre explícitamente
    if (dataCollectionState === "waiting_name") {
      // Agregar el mensaje del usuario primero
      await sessionManager.addMessage(userId, "user", userMessage, chatId);

      // Validar que parezca un nombre
      if (userDataManager.isValidName(trimmedMessage)) {
        // Capitalizar nombre (primera letra de cada palabra en mayúscula)
        const capitalizedName = trimmedMessage
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');

        await userDataManager.setUserData(userId, { name: capitalizedName });
        await userDataManager.markNameCollected(userId);
        await userDataManager.setWaitingForName(userId, false);

        const confirmationMessage = `¡Muchas gracias, ${capitalizedName}! 😊\n\n¿En qué puedo ayudarte hoy? Te puedo compartir información sobre:\n\n🏡 Terrenos disponibles y precios\n📍 Ubicación estratégica\n💰 Planes de financiamiento\n📊 Proyección de plusvalía\n\n¿Qué te interesa conocer?`;
        await sessionManager.addMessage(
          userId,
          "assistant",
          confirmationMessage,
          chatId
        );
        return confirmationMessage;
      } else {
        // Si no es un nombre válido, volver a pedir
        const retryMessage = `Por favor, proporciona un nombre válido:`;
        await sessionManager.addMessage(
          userId,
          "assistant",
          retryMessage,
          chatId
        );
        return retryMessage;
      }
    }

    // Si es usuario nuevo, usar el flujo de primeros mensajes según el documento
    if (dataCollectionState === "none") {
      await userDataManager.setUserData(userId, {});

      // Agregar el mensaje del usuario primero
      await sessionManager.addMessage(userId, "user", userMessage, chatId);

      // Seleccionar aleatoriamente uno de los 3 flujos de bienvenida
      const flujoAleatorio = Math.floor(Math.random() * 3) + 1;
      let welcomeMessage;

      if (flujoAleatorio === 1) {
        // Flujo 1: Primer contacto general - directo a pedir nombre
        welcomeMessage = `Hola! ☺️
Soy Daniel, asistente virtual de *Portto Blanco Terrenos Residenciales*.
Con gusto puedo compartirte información sobre nuestros desarrollos y opciones de inversión.
¿Podrías compartirme tu *nombre* para atenderte de forma personalizada?`;

        // Marcar que está esperando nombre
        await userDataManager.setWaitingForName(userId, true);
      } else if (flujoAleatorio === 2) {
        // Flujo 2: Cliente muestra interés directo
        welcomeMessage = `Hola! ☺️
Soy Daniel, asistente virtual de *Portto Blanco Terrenos Residenciales*.
En Portto Blanco ayudamos a nuestros inversionistas a duplicar el valor de su patrimonio en solo 5 años 📈

¿Te gustaría saber cómo puedes lograrlo?`;

        // Marcar que está esperando respuesta afirmativa para luego pedir nombre
        await userDataManager.setWaitingForNameAfterInterest(userId, true);
      } else {
        // Flujo 3: Información sobre ubicaciones y precios
        welcomeMessage = `¡Hola! ☺️
Soy Daniel, asistente virtual de Portto Blanco Terrenos Residenciales.
Puedo ayudarte a conocer nuestras ubicaciones, precios y beneficios exclusivos.
¿Te gustaría que te comparta más información?`;

        // Marcar que está esperando respuesta afirmativa para luego pedir nombre
        await userDataManager.setWaitingForNameAfterInterest(userId, true);
      }

      await sessionManager.addMessage(
        userId,
        "assistant",
        welcomeMessage,
        chatId
      );
      return welcomeMessage;
    }

    // Detectar si el usuario está proporcionando un email o nombre directamente
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Detectar email
    if (emailRegex.test(trimmedMessage.toLowerCase())) {
      // Verificar si hay una activación de soporte pendiente (cita agendada)
      const hasPending = await userDataManager.hasPendingSupportActivation(userId);
      console.log(`[DEBUG-EMAIL] Usuario ${userId} - hasPendingSupportActivation: ${hasPending}`);

      if (hasPending) {
        console.log(`[DEBUG-EMAIL] Redirigiendo a handleEmailCollection para ${userId}`);
        // Agregar mensaje del usuario a la sesión ANTES de manejar el email
        await sessionManager.addMessage(userId, "user", userMessage, chatId);
        // Redirigir al manejador de email para soporte (que mostrará directamente la cita y asesor)
        return await this.handleEmailCollection(userId, userMessage, chatId);
      }

      // Si no hay soporte pendiente, procesar email normalmente (SIN confirmación del correo)
      console.log(`[DEBUG-EMAIL] Procesando email normalmente para ${userId}`);
      const email = trimmedMessage.toLowerCase();
      await userDataManager.setUserData(userId, { email: email });
      const userData = await userDataManager.getUserData(userId);

      // Marcar datos como completos si tiene nombre y email
      if (userData.name) {
        await userDataManager.markDataAsCollected(userId);
      }

      // Agregar mensaje del usuario a la sesión
      await sessionManager.addMessage(userId, "user", userMessage, chatId);

      const name = userData?.name ? ` ${userData.name}` : "";
      const confirmationMessage = `¡Gracias${name}! ✅\n\nHe registrado tu correo: ${email}\n\n¿En qué más puedo ayudarte?`;
      await sessionManager.addMessage(
        userId,
        "assistant",
        confirmationMessage,
        chatId
      );
      return confirmationMessage;
    }

    // Obtener historial para análisis y detección de contexto
    let conversationHistory = await sessionManager.getMessages(userId, chatId);

    // Detectar si es un nombre (después de que el bot lo haya pedido en la conversación)
    const lastBotMessage = conversationHistory
      .filter((m) => m.role === "assistant")
      .slice(-1)[0];

    if (
      lastBotMessage &&
      (lastBotMessage.content.toLowerCase().includes("¿cómo puedo llamarte?") ||
        lastBotMessage.content.toLowerCase().includes("¿cuál es tu nombre?") ||
        lastBotMessage.content.toLowerCase().includes("tu nombre"))
    ) {
      // Validar que parezca un nombre
      if (userDataManager.isValidName(trimmedMessage)) {
        await userDataManager.setUserData(userId, { name: trimmedMessage });
        await userDataManager.markNameCollected(userId);

        // Agregar mensaje del usuario a la sesión
        await sessionManager.addMessage(userId, "user", userMessage, chatId);

        const confirmationMessage = `¡Mucho gusto, ${trimmedMessage}! ¿En qué más puedo ayudarte?`;
        await sessionManager.addMessage(
          userId,
          "assistant",
          confirmationMessage,
          chatId
        );
        return confirmationMessage;
      }
    }

    // Agregar mensaje del usuario a la sesión
    await sessionManager.addMessage(userId, "user", userMessage, chatId);

    // Actualizar historial después de agregar el mensaje
    conversationHistory = await sessionManager.getMessages(userId, chatId);

    // Analizar conversación y obtener asesor asignado
    let asesorAsignado = null;
    try {
      const analysis = await conversationAnalyzer.analyzeConversation(
        conversationHistory.map((msg) => ({
          type: msg.role === "user" ? "USER" : "BOT",
          message: msg.content,
        })),
        userId
      );
      asesorAsignado = analysis.asesor_asignado;
      console.log(
        `[Bot] Asesor asignado para ${userId}: ${asesorAsignado.nombre}`
      );
    } catch (error) {
      console.error("[Bot] Error analizando conversación:", error);
    }

    // Obtener datos del usuario para contexto
    const userData = await userDataManager.getUserData(userId);

    // Preparar prompt del sistema con información sobre datos del usuario
    let systemPromptWithContext = this.systemPrompt;

    if (userData) {
      systemPromptWithContext += `\n\n*DATOS DEL CLIENTE ACTUAL:*`;
      if (userData.name) {
        systemPromptWithContext += `\n- Nombre: ${userData.name} (YA TIENES EL NOMBRE, NO LO PIDAS DE NUEVO)`;
      } else {
        systemPromptWithContext += `\n- Nombre: No disponible (puedes pedirlo de forma natural después de 2-3 mensajes)`;
      }
      if (userData.email) {
        systemPromptWithContext += `\n- Correo: ${userData.email} (YA TIENES EL CORREO, NO LO PIDAS DE NUEVO)`;
      } else {
        systemPromptWithContext += `\n- Correo: No disponible (pídelo solo cuando sea necesario o al final de una conversación productiva)`;
      }
    }

    // Preparar mensajes para la IA
    const messages = [
      { role: "system", content: systemPromptWithContext },
      ...conversationHistory,
    ];

    // Generar respuesta con IA
    const aiResponse = await aiService.generateResponse(messages);
    console.log(`[DEBUG-AI] Respuesta de IA para ${userId}: ${aiResponse.substring(0, 200)}...`);

    // Verificar si la respuesta contiene el marcador de solicitar email para cita
    if (aiResponse.includes("{{SOLICITAR_EMAIL_PARA_CITA}}")) {
      console.log(`[DEBUG-AI] Marcador {{SOLICITAR_EMAIL_PARA_CITA}} detectado para ${userId}`);

      // Activar flag de pending support activation
      await userDataManager.setPendingSupportActivation(userId, true);
      console.log(`[DEBUG-SUPPORT] Flag pendingSupportActivation establecido para ${userId}`);

      // Remover el marcador de la respuesta antes de enviar
      const cleanResponse = aiResponse.replace("{{SOLICITAR_EMAIL_PARA_CITA}}", "").trim();

      // Agregar respuesta limpia a la sesión
      await sessionManager.addMessage(userId, "assistant", cleanResponse, chatId);

      return cleanResponse;
    }

    // Verificar si la respuesta contiene el marcador de activar soporte
    if (aiResponse.includes("{{ACTIVAR_SOPORTE}}")) {
      console.log(`[DEBUG-AI] Marcador {{ACTIVAR_SOPORTE}} detectado para ${userId}`);
      // Primero verificar si tenemos el email del usuario
      const userData = await userDataManager.getUserData(userId);
      if (!userData || !userData.email) {
        // Si no tenemos email, solicitarlo antes de activar soporte
        const cleanResponse = aiResponse
          .replace("{{ACTIVAR_SOPORTE}}", "")
          .trim();

        // Solo agregar la respuesta limpia si tiene contenido
        if (cleanResponse.length > 0) {
          await sessionManager.addMessage(
            userId,
            "assistant",
            cleanResponse,
            chatId
          );
        }

        await userDataManager.setPendingSupportActivation(userId, true);
        console.log(`[DEBUG-SUPPORT] Flag pendingSupportActivation establecido para ${userId}`);

        const emailRequest = `Para poder asignarte un asesor especializado y mantener un seguimiento de tu caso, necesito tu correo electrónico.\n\n📧 Por favor, proporciona tu correo electrónico:`;
        return emailRequest;
      }

      // Si ya tenemos el email, continuar con la activación del soporte
      // Remover el marcador de la respuesta
      const cleanResponse = aiResponse
        .replace("{{ACTIVAR_SOPORTE}}", "")
        .trim();

      // Activar modo soporte
      await humanModeManager.setMode(userId, "support");
      await sessionManager.updateSessionMode(userId, chatId, "support");

      // Incluir información del asesor asignado
      let finalResponse = cleanResponse;
      if (asesorAsignado) {
        finalResponse +=
          `\n\n📋 *Asesor asignado:* ${asesorAsignado.nombre}\n` +
          `_Especialidad: ${asesorAsignado.especialidades.join(", ")}_`;
      }

      // Agregar respuesta con información del asesor
      await sessionManager.addMessage(
        userId,
        "assistant",
        finalResponse,
        chatId
      );

      // Registrar en logs con el asesor asignado
      const logMessage = asesorAsignado
        ? `Modo SOPORTE activado para ${userId} - Asesor: ${asesorAsignado.nombre}`
        : `Modo SOPORTE activado automáticamente para ${userId}`;
      await logger.log("SYSTEM", logMessage);

      return finalResponse;
    }

    // Agregar respuesta de IA a la sesión
    await sessionManager.addMessage(userId, "assistant", aiResponse, chatId);

    return aiResponse;
  }

  async handleError(error, message) {
    console.error("Error procesando mensaje:", error);

    const from = message.key.remoteJid;
    const userId = from.replace("@s.whatsapp.net", "");

    let errorMessage = "Lo siento, ocurrió un error. Inténtalo de nuevo.";

    if (
      error.message.includes("autenticación") ||
      error.message.includes("API key")
    ) {
      errorMessage =
        "Error de configuración del bot. Por favor, contacta al administrador.";
    }

    try {
      await this.sock.sendMessage(from, { text: errorMessage });
      logger.log("ERROR", error.message, userId);
    } catch (sendError) {
      console.error("Error enviando mensaje de error:", sendError);
    }
  }

  async stop() {
    console.log("Cerrando bot...");
    if (this.sock) {
      this.sock.end();
    }
  }

  async clearSession() {
    const fs = require("fs").promises;
    const path = require("path");
    const authPath = path.join(process.cwd(), "auth_baileys");

    try {
      await fs.rm(authPath, { recursive: true, force: true });
      console.log("Sesión eliminada correctamente");
    } catch (err) {
      console.log("No había sesión previa o ya fue eliminada");
    }
  }

  async logout() {
    console.log("Cerrando sesión de WhatsApp...");
    try {
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      if (this.sock) {
        try {
          await this.sock.logout();
        } catch (err) {
          console.log("Error al hacer logout:", err.message);
        }
      }

      await this.clearSession();

      // Reiniciar el bot para generar nuevo QR
      setTimeout(() => this.start(), 2000);
      return true;
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      return false;
    }
  }

  async handleEmailCollection(userId, userMessage, chatId) {
    // Validar y guardar email
    const email = userMessage.trim().toLowerCase();
    if (!userDataManager.isValidEmail(email)) {
      // Agregar el mensaje del usuario al historial antes de responder
      await sessionManager.addMessage(userId, "user", userMessage, chatId);
      const errorMessage = `Por favor, ingresa un correo electrónico válido (ejemplo: tucorreo@ejemplo.com):`;
      await sessionManager.addMessage(
        userId,
        "assistant",
        errorMessage,
        chatId
      );
      return errorMessage;
    }

    // Guardar email y marcar datos como completos
    await userDataManager.setUserData(userId, { email: email });
    await userDataManager.markDataAsCollected(userId);
    const userData = await userDataManager.getUserData(userId);

    // Verificar si había una activación de soporte pendiente
    const hasPendingSupport = await userDataManager.hasPendingSupportActivation(userId);
    console.log(`[DEBUG] hasPendingSupportActivation para ${userId}: ${hasPendingSupport}`);

    if (hasPendingSupport) {
      // Limpiar el flag de soporte pendiente
      await userDataManager.setPendingSupportActivation(userId, false);

      // Activar modo soporte
      await humanModeManager.setMode(userId, "support");
      await sessionManager.updateSessionMode(userId, chatId, "support");

      // Obtener asesor asignado
      const conversationHistory = await sessionManager.getMessages(
        userId,
        chatId
      );
      let asesorAsignado = null;

      try {
        const analysis = await conversationAnalyzer.analyzeConversation(
          conversationHistory.map((msg) => ({
            type: msg.role === "user" ? "USER" : "BOT",
            message: msg.content,
          })),
          userId
        );
        asesorAsignado = analysis.asesor_asignado;
      } catch (error) {
        console.error("[Bot] Error analizando conversación:", error);
      }

      // Preparar respuesta directamente con información del asesor (sin mensaje intermedio)
      let response = `📋 *Tu cita ha sido registrada*\n\n`;

      if (asesorAsignado) {
        response +=
          `*Asesor asignado:* ${asesorAsignado.nombre}\n` +
          `_Especialidad: ${asesorAsignado.especialidades.join(", ")}_\n\n` +
          `En breve ${asesorAsignado.nombre} tomará el control de esta conversación para ayudarte.`;
      } else {
        response += `Uno de nuestros asesores especializados tomará el control de esta conversación en breve.`;
      }

      // Registrar en logs
      const logMessage = asesorAsignado
        ? `Modo SOPORTE activado para ${userId} - Asesor: ${asesorAsignado.nombre}`
        : `Modo SOPORTE activado para ${userId}`;
      await logger.log("SYSTEM", logMessage);

      // Agregar respuesta al historial
      await sessionManager.addMessage(userId, "assistant", response, chatId);

      return response;
    } else {
      // Solo confirmación de email sin activar soporte
      return `¡Gracias ${userData.name}! ✅\n\nHe registrado tu correo: ${email}\n\n¿En qué más puedo ayudarte?`;
    }
  }
}

module.exports = WhatsAppBot;
