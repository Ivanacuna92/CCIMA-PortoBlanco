const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const router = express.Router();

// Importar módulos del voicebot (con manejo de errores si no están inicializados)
let voicebotDB, campaignManager;

const loadVoicebotModules = () => {
    if (!voicebotDB) {
        try {
            voicebotDB = require('../services/voicebot/voicebotDatabase');
        } catch (e) {
            console.error('[VoicebotRoutes] Error cargando voicebotDatabase:', e.message);
        }
    }
    if (!campaignManager) {
        try {
            campaignManager = require('../services/voicebot/campaignManager');
        } catch (e) {
            console.error('[VoicebotRoutes] Error cargando campaignManager:', e.message);
        }
    }
};

// Configurar multer para CSV
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos CSV'));
        }
    }
});

// ==================== CAMPAIGNS ====================

// Descargar plantilla CSV (DEBE ir antes de /campaigns/:id)
router.get('/campaigns/template', (req, res) => {
    const csvContent = 'Teléfono,Nombre,Tipo de Terreno,Ubicación,Tamaño (m2),Precio,Info Adicional\n7771234567,Juan Pérez,residencial,Cuernavaca,500,3500000,Interesado en terreno con servicios\n';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_voicebot.csv');
    res.send(csvContent);
});

// Obtener todas las campanas
router.get('/campaigns', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.json({ campaigns: [] });
        }
        const campaigns = await voicebotDB.getAllCampaigns();
        res.json({ campaigns: campaigns || [] });
    } catch (error) {
        console.error('[VoicebotRoutes] Error obteniendo campanas:', error);
        res.json({ campaigns: [] });
    }
});

// Obtener una campana por ID
router.get('/campaigns/:id', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.status(503).json({ error: 'Voicebot no inicializado' });
        }
        const campaign = await voicebotDB.getCampaign(req.params.id);
        if (!campaign) {
            return res.status(404).json({ error: 'Campana no encontrada' });
        }
        res.json({ campaign });
    } catch (error) {
        console.error('[VoicebotRoutes] Error obteniendo campana:', error);
        res.status(500).json({ error: 'Error obteniendo campana' });
    }
});

// Crear nueva campana (ruta /campaigns/create para compatibilidad)
router.post('/campaigns/create', upload.single('csv'), async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.status(503).json({ error: 'Voicebot no inicializado' });
        }

        const { campaignName } = req.body;
        const csvFile = req.file;

        if (!campaignName || !csvFile) {
            return res.status(400).json({ error: 'Nombre de campana y archivo CSV son requeridos' });
        }

        // Parsear CSV
        const csvContent = csvFile.buffer.toString('utf8');
        let records;
        try {
            records = parse(csvContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true
            });
        } catch (parseError) {
            return res.status(400).json({ error: 'Error parseando CSV: ' + parseError.message });
        }

        if (records.length === 0) {
            return res.status(400).json({ error: 'El CSV no contiene registros' });
        }

        // Crear campana
        const campaignId = await voicebotDB.createCampaign({
            campaignName,
            csvFilename: csvFile.originalname,
            totalContacts: records.length,
            createdBy: req.user?.name || 'Sistema'
        });

        // Procesar contactos del CSV
        const contacts = records.map(row => {
            return {
                phone: row.phone || row.telefono || row.Phone || row.Telefono || row.Teléfono || '',
                name: row.name || row.nombre || row.Name || row.Nombre || '',
                propertyType: row.propertyType || row.propertytype || row.tipo || row.Tipo || row['Tipo de Terreno'] || '',
                location: row.location || row.ubicacion || row.Location || row.Ubicacion || row.Ubicación || '',
                size: row.size || row.tamano || row.Size || row.Tamano || row['Tamaño (m2)'] || '',
                price: row.price || row.precio || row.Price || row.Precio || row['Precio (MXN)'] || '',
                extraInfo: row.extraInfo || row.extra || row.notas || row.Notas || row['Info Adicional'] || ''
            };
        }).filter(c => c.phone);

        if (contacts.length === 0) {
            await voicebotDB.deleteCampaign(campaignId);
            return res.status(400).json({ error: 'No se encontraron contactos validos (columna phone/telefono requerida)' });
        }

        // Agregar contactos a la campana
        await voicebotDB.addContacts(campaignId, contacts);

        res.json({
            success: true,
            campaignId,
            contactsAdded: contacts.length,
            message: `Campana creada con ${contacts.length} contactos`
        });
    } catch (error) {
        console.error('[VoicebotRoutes] Error creando campana:', error);
        res.status(500).json({ error: 'Error creando campana: ' + error.message });
    }
});

// Iniciar campana
router.post('/campaigns/:id/start', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!campaignManager) {
            return res.status(503).json({ error: 'Campaign Manager no inicializado' });
        }

        const result = await campaignManager.startCampaign(parseInt(req.params.id));
        if (result.success) {
            res.json({ success: true, message: 'Campana iniciada' });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('[VoicebotRoutes] Error iniciando campana:', error);
        res.status(500).json({ error: 'Error iniciando campana' });
    }
});

// Pausar campana
router.post('/campaigns/:id/pause', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!campaignManager) {
            return res.status(503).json({ error: 'Campaign Manager no inicializado' });
        }

        const result = await campaignManager.pauseCampaign(parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        console.error('[VoicebotRoutes] Error pausando campana:', error);
        res.status(500).json({ error: 'Error pausando campana' });
    }
});

// Detener campana
router.post('/campaigns/:id/stop', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!campaignManager) {
            return res.status(503).json({ error: 'Campaign Manager no inicializado' });
        }

        const result = await campaignManager.stopCampaign(parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        console.error('[VoicebotRoutes] Error deteniendo campana:', error);
        res.status(500).json({ error: 'Error deteniendo campana' });
    }
});

// Eliminar campana
router.delete('/campaigns/:id', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.status(503).json({ error: 'Voicebot no inicializado' });
        }

        await voicebotDB.deleteCampaign(parseInt(req.params.id));
        res.json({ success: true, message: 'Campana eliminada' });
    } catch (error) {
        console.error('[VoicebotRoutes] Error eliminando campana:', error);
        res.status(500).json({ error: 'Error eliminando campana' });
    }
});

// Obtener estadisticas de una campana
router.get('/campaigns/:id/stats', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.json({ stats: {} });
        }

        const stats = await voicebotDB.getCampaignStats(parseInt(req.params.id));
        res.json({ stats: stats || {} });
    } catch (error) {
        console.error('[VoicebotRoutes] Error obteniendo estadisticas:', error);
        res.json({ stats: {} });
    }
});

// Obtener llamadas de una campana
router.get('/campaigns/:id/calls', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.json({ calls: [] });
        }

        const calls = await voicebotDB.getCampaignCalls(parseInt(req.params.id));
        res.json({ calls: calls || [] });
    } catch (error) {
        console.error('[VoicebotRoutes] Error obteniendo llamadas:', error);
        res.json({ calls: [] });
    }
});

// Obtener citas de una campana
router.get('/campaigns/:id/appointments', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.json({ appointments: [] });
        }

        const appointments = await voicebotDB.getCampaignAppointments(parseInt(req.params.id));
        res.json({ appointments: appointments || [] });
    } catch (error) {
        console.error('[VoicebotRoutes] Error obteniendo citas:', error);
        res.json({ appointments: [] });
    }
});

// ==================== CALLS ====================

// Obtener transcripcion de una llamada
router.get('/calls/:id/transcription', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.json({ transcription: [] });
        }

        const transcription = await voicebotDB.getTranscriptions(parseInt(req.params.id));
        res.json({ transcription: transcription || [] });
    } catch (error) {
        console.error('[VoicebotRoutes] Error obteniendo transcripcion:', error);
        res.json({ transcription: [] });
    }
});

// ==================== APPOINTMENTS ====================

// Obtener todas las citas
router.get('/appointments', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.json({ appointments: [] });
        }

        const appointments = await voicebotDB.getAllAppointments();
        res.json({ appointments: appointments || [] });
    } catch (error) {
        console.error('[VoicebotRoutes] Error obteniendo citas:', error);
        res.json({ appointments: [] });
    }
});

// Actualizar estado de cita
router.put('/appointments/:id/status', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.status(503).json({ error: 'Voicebot no inicializado' });
        }

        const { status } = req.body;
        await voicebotDB.updateAppointmentStatus(parseInt(req.params.id), status);
        res.json({ success: true });
    } catch (error) {
        console.error('[VoicebotRoutes] Error actualizando estado:', error);
        res.status(500).json({ error: 'Error actualizando estado' });
    }
});

// Actualizar cita
router.put('/appointments/:id', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.status(503).json({ error: 'Voicebot no inicializado' });
        }

        await voicebotDB.updateAppointment(parseInt(req.params.id), req.body);
        res.json({ success: true });
    } catch (error) {
        console.error('[VoicebotRoutes] Error actualizando cita:', error);
        res.status(500).json({ error: 'Error actualizando cita' });
    }
});

// Eliminar cita
router.delete('/appointments/:id', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.status(503).json({ error: 'Voicebot no inicializado' });
        }

        await voicebotDB.deleteAppointment(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) {
        console.error('[VoicebotRoutes] Error eliminando cita:', error);
        res.status(500).json({ error: 'Error eliminando cita' });
    }
});

// ==================== STATUS ====================

// Obtener estado del Campaign Manager
router.get('/status', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!campaignManager) {
            return res.json({
                activeCallsCount: 0,
                maxConcurrentCalls: 2,
                asteriskConnected: false,
                activeCampaigns: []
            });
        }

        const status = campaignManager.getStatus();
        res.json(status);
    } catch (error) {
        console.error('[VoicebotRoutes] Error obteniendo estado:', error);
        res.json({
            activeCallsCount: 0,
            maxConcurrentCalls: 2,
            asteriskConnected: false,
            activeCampaigns: []
        });
    }
});

// ==================== CONFIG ====================

// Obtener configuracion
router.get('/config', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.json({ config: {} });
        }

        const config = await voicebotDB.getConfig();
        res.json({ config: config || {} });
    } catch (error) {
        console.error('[VoicebotRoutes] Error obteniendo config:', error);
        res.json({ config: {} });
    }
});

// Actualizar configuracion
router.put('/config', async (req, res) => {
    try {
        loadVoicebotModules();
        if (!voicebotDB) {
            return res.status(503).json({ error: 'Voicebot no inicializado' });
        }

        const { key, value } = req.body;
        await voicebotDB.updateConfig(key, value);
        res.json({ success: true });
    } catch (error) {
        console.error('[VoicebotRoutes] Error actualizando config:', error);
        res.status(500).json({ error: 'Error actualizando config' });
    }
});

module.exports = router;
