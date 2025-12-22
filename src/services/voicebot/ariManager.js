const ariClient = require('ari-client');
const EventEmitter = require('events');
require('dotenv').config();

class ARIManager extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.connected = false;
        this.activeCalls = new Map();
    }

    async connect() {
        this.client = await ariClient.connect(
            process.env.ASTERISK_ARI_URL || 'http://localhost:8089',
            process.env.ASTERISK_ARI_USERNAME || 'voicebot',
            process.env.ASTERISK_ARI_PASSWORD || ''
        );

        this.connected = true;
        this.client.start('voicebot-portoblanco');

        // Evento cuando una llamada entra a Stasis
        this.client.on('StasisStart', async (event, channel) => {
            const phoneNumber = event.args[0] || 'unknown';

            // Contestar el canal
            await channel.answer();

            // Crear puente de audio (necesario para grabar/reproducir)
            const bridge = this.client.Bridge();
            await bridge.create({ type: 'mixing' });
            await bridge.addChannel({ channel: channel.id });

            this.activeCalls.set(channel.id, { channel, bridge, phoneNumber });

            // Emitir evento para el Campaign Manager
            this.emit('callAnswered', {
                channelId: channel.id,
                bridgeId: bridge.id,
                phoneNumber: phoneNumber,
                channel: channel,
                bridge: bridge
            });
        });

        this.client.on('StasisEnd', async (event, channel) => {
            const callData = this.activeCalls.get(channel.id);
            if (callData?.bridge) {
                try { await callData.bridge.destroy(); } catch(e) {}
            }
            this.activeCalls.delete(channel.id);
        });

        console.log('[ARI] Conectado a Asterisk ARI');
    }

    async originateCall(phoneNumber, context = 'voicebot-ari') {
        const trunkName = process.env.ASTERISK_TRUNK_NAME || 'trunk-navetec';
        const trunkPrefix = process.env.TRUNK_PREFIX || '';

        // Limpiar número (solo dígitos)
        const cleanNumber = phoneNumber.replace(/\D/g, '');

        // Agregar prefijo del trunk si está configurado
        const dialNumber = trunkPrefix ? `${trunkPrefix}${cleanNumber}` : cleanNumber;
        const endpoint = `PJSIP/${dialNumber}@${trunkName}`;

        console.log(`[ARI] Originando llamada: ${endpoint}`);

        const channel = this.client.Channel();
        await channel.originate({
            endpoint: endpoint,
            app: 'voicebot-portoblanco',
            appArgs: phoneNumber,
            callerId: process.env.TRUNK_CALLER_ID || 'PortoBlanco',
            timeout: 30
        });

        return { success: true, phoneNumber, dialedNumber: dialNumber };
    }

    async playAudio(bridgeId, audioPath) {
        // audioPath sin extensión, ej: "custom/mi_audio"
        const soundPath = audioPath.replace(/\.(wav|mp3)$/i, '');

        const callData = Array.from(this.activeCalls.values())
            .find(c => c.bridge?.id === bridgeId);

        if (callData?.channel) {
            const playback = await callData.channel.play({
                media: `sound:${soundPath}`
            });

            // Esperar que termine
            await new Promise(resolve => {
                playback.once('PlaybackFinished', resolve);
                playback.once('PlaybackFailed', resolve);
                setTimeout(resolve, 30000);
            });
        }
    }

    async recordAudioFromBridge(bridgeId, recordingName, maxDuration = 8) {
        const cleanName = recordingName.replace('.wav', '').split('/').pop();

        const bridge = this.client.Bridge();
        bridge.id = bridgeId;

        const recording = await bridge.record({
            name: cleanName,
            format: 'wav',
            maxDurationSeconds: maxDuration,
            maxSilenceSeconds: 1.5,  // 1.5s de silencio antes de cortar (permite pausas naturales)
            ifExists: 'overwrite',
            beep: false,
            terminateOn: 'none'
        });

        // Esperar que termine
        await new Promise(resolve => {
            recording.once('RecordingFinished', resolve);
            recording.once('RecordingFailed', resolve);
            setTimeout(resolve, (maxDuration + 1) * 1000);
        });

        return `/var/spool/asterisk/recording/${cleanName}.wav`;
    }

    async hangup(channelId) {
        const channel = this.client.Channel();
        channel.id = channelId;
        await channel.hangup();
    }

    getActiveCall(channelId) {
        return this.activeCalls.get(channelId);
    }

    getActiveCallsCount() {
        return this.activeCalls.size;
    }

    isConnected() {
        return this.connected;
    }
}

module.exports = new ARIManager();
