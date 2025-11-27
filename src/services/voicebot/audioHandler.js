const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const execPromise = util.promisify(exec);
require('dotenv').config();

class AudioHandler {
    constructor() {
        this.recordingPath = process.env.VOICEBOT_RECORDING_PATH || '/var/lib/asterisk/sounds/recordings';
        this.customSoundsPath = '/usr/share/asterisk/sounds/custom';
    }

    async initialize() {
        // Verificar que SOX esta instalado
        try {
            await execPromise('sox --version');
            console.log('[AudioHandler] SOX disponible');
        } catch (e) {
            console.error('[AudioHandler] SOX no instalado. Ejecuta: apt install sox');
        }

        // Crear directorios necesarios
        try {
            await fs.mkdir(this.recordingPath, { recursive: true });
            await fs.mkdir(this.customSoundsPath, { recursive: true });
            await fs.mkdir('/tmp/voicebot_tts', { recursive: true });
            console.log('[AudioHandler] Directorios de audio listos');
        } catch (e) {
            console.error('[AudioHandler] Error creando directorios:', e.message);
        }
    }

    // Convertir PCM 24kHz (OpenAI TTS) a WAV 8kHz (Asterisk)
    async convertForAsteriskPlaybackDirect(pcmPath, wavPath = null) {
        if (!wavPath) {
            wavPath = pcmPath.replace('.pcm', '.wav');
        }

        const command = `sox -t raw -r 24000 -b 16 -c 1 -e signed-integer -L "${pcmPath}" -r 8000 "${wavPath}"`;
        await execPromise(command);

        // Copiar a directorio de sonidos de Asterisk
        const filename = path.basename(wavPath);
        const asteriskPath = `${this.customSoundsPath}/${filename}`;
        await fs.copyFile(wavPath, asteriskPath);

        return asteriskPath;
    }

    // Mejorar audio grabado para Whisper (reduce ruido, normaliza)
    async enhanceForWhisper(inputPath, outputPath = null) {
        if (!outputPath) {
            outputPath = inputPath.replace('.wav', '_enhanced.wav');
        }

        // Filtros: highpass 300Hz, lowpass 3400Hz (rango de voz), normalizar, compresion
        const command = `sox "${inputPath}" -r 16000 -c 1 "${outputPath}" highpass 300 lowpass 3400 norm -1 compand 0.3,1 6:-70,-60,-20 -5 -90 0.2`;
        await execPromise(command);
        return outputPath;
    }

    // Convertir cualquier formato a WAV 8kHz mono (Asterisk compatible)
    async convertToAsteriskFormat(inputPath, outputPath = null) {
        if (!outputPath) {
            outputPath = inputPath.replace(/\.[^.]+$/, '_asterisk.wav');
        }

        const command = `sox "${inputPath}" -r 8000 -c 1 -b 16 "${outputPath}"`;
        await execPromise(command);
        return outputPath;
    }

    // Convertir a formato optimo para Whisper (16kHz mono)
    async convertToWhisperFormat(inputPath, outputPath = null) {
        if (!outputPath) {
            outputPath = inputPath.replace(/\.[^.]+$/, '_whisper.wav');
        }

        const command = `sox "${inputPath}" -r 16000 -c 1 -b 16 "${outputPath}"`;
        await execPromise(command);
        return outputPath;
    }

    // Detectar si hay voz en el audio (basado en nivel RMS)
    async hasVoiceActivity(audioPath, threshold = 0.01) {
        try {
            const { stdout } = await execPromise(`sox "${audioPath}" -n stat 2>&1 | grep "RMS.*amplitude"`);
            const rmsMatch = stdout.match(/RMS\s+amplitude:\s+([\d.]+)/);
            if (rmsMatch) {
                const rms = parseFloat(rmsMatch[1]);
                return rms > threshold;
            }
        } catch (e) {
            // Si falla, asumir que hay voz
        }
        return true;
    }

    // Obtener duracion del audio en segundos
    async getAudioDuration(audioPath) {
        try {
            const { stdout } = await execPromise(`soxi -D "${audioPath}"`);
            return parseFloat(stdout.trim());
        } catch (e) {
            return 0;
        }
    }

    // Generar path para grabacion
    generateRecordingPath(callId, sequence, type = 'client') {
        return `${this.recordingPath}/call_${callId}_${sequence}_${type}_${Date.now()}.wav`;
    }

    // Generar path para TTS
    generateTTSPath(conversationId) {
        return `/tmp/voicebot_tts/tts_${conversationId}_${Date.now()}`;
    }

    // Limpiar archivos temporales antiguos (> 24 horas)
    async cleanupOldRecordings(maxAgeHours = 24) {
        const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
        const now = Date.now();

        const dirs = ['/tmp/voicebot_tts', this.recordingPath];

        for (const dir of dirs) {
            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    const stats = await fs.stat(filePath);
                    if (now - stats.mtimeMs > maxAgeMs) {
                        await fs.unlink(filePath);
                    }
                }
            } catch (e) {
                // Directorio no existe o error de permisos
            }
        }
    }

    // Concatenar multiples audios en uno solo
    async concatenateAudios(audioPaths, outputPath) {
        const inputs = audioPaths.map(p => `"${p}"`).join(' ');
        const command = `sox ${inputs} "${outputPath}"`;
        await execPromise(command);
        return outputPath;
    }

    // Agregar silencio al inicio o final del audio
    async addSilence(inputPath, outputPath, silenceSeconds = 0.5, position = 'start') {
        const silenceFile = `/tmp/silence_${Date.now()}.wav`;
        await execPromise(`sox -n -r 8000 -c 1 "${silenceFile}" trim 0.0 ${silenceSeconds}`);

        if (position === 'start') {
            await execPromise(`sox "${silenceFile}" "${inputPath}" "${outputPath}"`);
        } else {
            await execPromise(`sox "${inputPath}" "${silenceFile}" "${outputPath}"`);
        }

        await fs.unlink(silenceFile).catch(() => {});
        return outputPath;
    }
}

module.exports = new AudioHandler();
