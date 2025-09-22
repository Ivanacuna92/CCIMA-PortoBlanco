const makeWASocket = require("baileys").default;
const {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
} = require("baileys");
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

      // Crear store en memoria para manejar mensajes
      this.store = makeInMemoryStore({
        logger: pino({ level: "silent" }),
      });

      // Crear socket de WhatsApp con configuración mejorada para producción
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
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        qrTimeout: undefined,
        markOnlineOnConnect: false,
        msgRetryCounterCache: {},
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        auth: state,
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
          console.log(
            "Conexión cerrada debido a",
            lastDisconnect?.error,
            ", reconectando:",
            shouldReconnect
          );

          // Si es error 405 o 401, limpiar sesión y reiniciar con límite
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
          sessionManager.startCleanupTimer(this.sock);
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
          return;
        }

        // Procesar mensaje y generar respuesta
        const response = await this.processMessage(userId, conversation, from);

        // Enviar respuesta
        await this.sock.sendMessage(from, { text: response });
        await logger.log("bot", response, userId, userName);
      } catch (error) {
        await this.handleError(error, m.messages[0]);
      }
    });
  }

  async processMessage(userId, userMessage, chatId) {
    // Verificar si necesitamos recolectar datos del usuario (solo nombre al inicio)
    const dataCollectionState = userDataManager.getDataCollectionState(userId);

    // Solo solicitar nombre al inicio, el email se solicitará antes del modo soporte
    if (
      dataCollectionState === "none" ||
      dataCollectionState === "name_pending"
    ) {
      const response = await this.handleInitialDataCollection(
        userId,
        userMessage,
        dataCollectionState
      );
      if (response) {
        return response;
      }
    }

    // Verificar si estamos esperando el email para activar soporte
    if (dataCollectionState === "email_pending_for_support") {
      return await this.handleEmailCollection(userId, userMessage, chatId);
    }

    // Agregar mensaje del usuario a la sesión
    await sessionManager.addMessage(userId, "user", userMessage, chatId);

    // Obtener historial para análisis
    const conversationHistory = await sessionManager.getMessages(
      userId,
      chatId
    );

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

    // Preparar mensajes para la IA
    const messages = [
      { role: "system", content: this.systemPrompt },
      ...conversationHistory,
    ];

    // Generar respuesta con IA
    const aiResponse = await aiService.generateResponse(messages);

    // Verificar si la respuesta contiene el marcador de activar soporte
    if (aiResponse.includes("{{ACTIVAR_SOPORTE}}")) {
      // Primero verificar si tenemos el email del usuario
      const userData = await userDataManager.getUserData(userId);
      if (!userData || !userData.email) {
        // Si no tenemos email, solicitarlo antes de activar soporte
        await sessionManager.addMessage(
          userId,
          "assistant",
          aiResponse.replace("{{ACTIVAR_SOPORTE}}", "").trim(),
          chatId
        );
        await userDataManager.setPendingSupportActivation(userId, true);

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

  async handleInitialDataCollection(userId, userMessage, state) {
    switch (state) {
      case "none":
        // Primera vez, dar bienvenida y solicitar nombre
        const welcomeMessage = `¡Hola! 👋 Bienvenido a nuestro servicio de atención.\n\nPara brindarte una mejor experiencia personalizada, ¿podrías decirme tu nombre completo por favor?`;
        await userDataManager.setUserData(userId, {});
        return welcomeMessage;

      case "name_pending":
        // Validar y guardar nombre
        const name = userMessage.trim();
        if (userDataManager.isValidName(name)) {
          await userDataManager.setUserData(userId, { name: name });
          await userDataManager.markNameCollected(userId);
          return `¡Mucho gusto.\n\nEstoy aquí para brindarte información precisa sobre:\n• Ubicación estratégica de parques industriales\n• Metraje disponible y especificaciones técnicas\n• Precios y planes de financiamiento\n• Proyecciones de plusvalía\n• Contexto de crecimiento industrial y comercial en la zona\n\n¿En qué puedo ayudarte hoy?`;
        } else {
          return `Por favor, ingresa un nombre válido (solo letras y espacios, mínimo 2 caracteres). ¿Cuál es tu nombre completo?`;
        }
    }

    return null; // Continuar con el flujo normal
  }

  async handleEmailCollection(userId, userMessage, chatId) {
    // Validar y guardar email
    const email = userMessage.trim().toLowerCase();
    if (!userDataManager.isValidEmail(email)) {
      return `Por favor, ingresa un correo electrónico válido (ejemplo: tucorreo@ejemplo.com):`;
    }

    // Guardar email y marcar datos como completos
    await userDataManager.setUserData(userId, { email: email });
    await userDataManager.markDataAsCollected(userId);
    const userData = await userDataManager.getUserData(userId);

    // Verificar si había una activación de soporte pendiente
    if (await userDataManager.hasPendingSupportActivation(userId)) {
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

      // Preparar respuesta con información del asesor
      let response = `¡Perfecto ${userData.name}! ✅\n\nHe registrado tu correo: ${email}\n\nTe estoy transfiriendo con uno de nuestros asesores especializados que te ayudará con tu caso.`;

      if (asesorAsignado) {
        response +=
          `\n\n📋 *Asesor asignado:* ${asesorAsignado.nombre}\n` +
          `_Especialidad: ${asesorAsignado.especialidades.join(", ")}_`;
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
