const database = require('../database');

class VoicebotDatabase {
    // ==================== CAMPAIGNS ====================

    async createCampaign(data) {
        const campaignId = await database.insert('voicebot_campaigns', {
            campaign_name: data.campaignName,
            csv_filename: data.csvFilename,
            total_contacts: data.totalContacts || 0,
            created_by: data.createdBy,
            status: 'pending'
        });
        return campaignId;
    }

    async getCampaign(campaignId) {
        return await database.findOne('voicebot_campaigns', 'id = ?', [campaignId]);
    }

    async getAllCampaigns(limit = 50) {
        const sql = `
            SELECT
                c.*,
                (SELECT COUNT(*) FROM voicebot_contacts WHERE campaign_id = c.id) as total_contacts,
                (SELECT COUNT(*) FROM voicebot_calls WHERE campaign_id = c.id AND call_status = 'completed') as calls_completed,
                (SELECT COUNT(*) FROM voicebot_appointments WHERE campaign_id = c.id) as appointments_scheduled
            FROM voicebot_campaigns c
            ORDER BY c.created_at DESC
            LIMIT ?
        `;
        return await database.query(sql, [limit]);
    }

    async getCampaignsByStatus(status, limit = 50) {
        const sql = `SELECT * FROM voicebot_campaigns WHERE status = ? ORDER BY created_at DESC LIMIT ?`;
        return await database.query(sql, [status, limit]);
    }

    async updateCampaignStatus(campaignId, status) {
        const updateData = { status };

        if (status === 'running') {
            const campaign = await this.getCampaign(campaignId);
            if (!campaign?.started_at) {
                updateData.started_at = new Date();
            }
        } else if (status === 'completed' || status === 'cancelled') {
            updateData.completed_at = new Date();
        }

        return await database.update('voicebot_campaigns', updateData, 'id = ?', [campaignId]);
    }

    async updateCampaignStats(campaignId) {
        const sql = `
            UPDATE voicebot_campaigns
            SET
                calls_completed = (SELECT COUNT(*) FROM voicebot_contacts WHERE campaign_id = ? AND call_status = 'completed'),
                calls_pending = (SELECT COUNT(*) FROM voicebot_contacts WHERE campaign_id = ? AND call_status = 'pending'),
                calls_failed = (SELECT COUNT(*) FROM voicebot_contacts WHERE campaign_id = ? AND call_status = 'failed'),
                appointments_scheduled = (SELECT COUNT(*) FROM voicebot_appointments WHERE campaign_id = ?)
            WHERE id = ?
        `;
        return await database.query(sql, [campaignId, campaignId, campaignId, campaignId, campaignId]);
    }

    async deleteCampaign(campaignId) {
        return await database.delete('voicebot_campaigns', 'id = ?', [campaignId]);
    }

    // ==================== CONTACTS ====================

    async addContact(campaignId, contactData) {
        return await database.insert('voicebot_contacts', {
            campaign_id: campaignId,
            phone_number: contactData.phone,
            client_name: contactData.name,
            property_type: contactData.propertyType,
            property_location: contactData.location,
            property_size: contactData.size,
            property_price: contactData.price,
            extra_info: contactData.extraInfo,
            call_status: 'pending'
        });
    }

    async addContacts(campaignId, contacts) {
        const results = [];
        for (const contact of contacts) {
            const id = await this.addContact(campaignId, contact);
            results.push(id);
        }
        return results;
    }

    async getContact(contactId) {
        return await database.findOne('voicebot_contacts', 'id = ?', [contactId]);
    }

    async getContactByPhone(campaignId, phone) {
        return await database.findOne('voicebot_contacts', 'campaign_id = ? AND phone_number = ?', [campaignId, phone]);
    }

    async getPendingContacts(campaignId, limit = 1) {
        const sql = `
            SELECT * FROM voicebot_contacts
            WHERE campaign_id = ? AND call_status = 'pending'
            ORDER BY id ASC
            LIMIT ?
        `;
        return await database.query(sql, [campaignId, limit]);
    }

    async getCampaignContacts(campaignId) {
        return await database.findAll('voicebot_contacts', 'campaign_id = ?', [campaignId], 'id ASC');
    }

    async updateContactStatus(contactId, status) {
        return await database.update('voicebot_contacts', {
            call_status: status,
            last_attempt_at: new Date()
        }, 'id = ?', [contactId]);
    }

    async updateContactInterest(contactId, interestLevel) {
        let level = interestLevel || 'medium';
        if (level === 'none') level = 'low';

        return await database.update('voicebot_contacts', {
            interest_level: level
        }, 'id = ?', [contactId]);
    }

    async incrementCallAttempts(contactId) {
        const sql = `UPDATE voicebot_contacts SET call_attempts = call_attempts + 1, last_attempt_at = NOW() WHERE id = ?`;
        return await database.query(sql, [contactId]);
    }

    // ==================== CALLS ====================

    async createCall(callData) {
        return await database.insert('voicebot_calls', {
            contact_id: callData.contactId || null,
            campaign_id: callData.campaignId || null,
            phone_number: callData.phoneNumber || null,
            call_start: new Date(),
            call_status: 'ringing',
            asterisk_channel: callData.channel || null,
            asterisk_uniqueid: callData.uniqueId || null
        });
    }

    async getCall(callId) {
        return await database.findOne('voicebot_calls', 'id = ?', [callId]);
    }

    async getCallByChannel(channel) {
        return await database.findOne('voicebot_calls', 'asterisk_channel = ?', [channel]);
    }

    async getCampaignCalls(campaignId) {
        const sql = `
            SELECT
                c.*,
                co.client_name,
                co.phone_number as contact_phone
            FROM voicebot_calls c
            LEFT JOIN voicebot_contacts co ON c.contact_id = co.id
            WHERE c.campaign_id = ?
            ORDER BY c.call_start DESC
        `;
        return await database.query(sql, [campaignId]);
    }

    async getRecentCalls(limit = 20) {
        const sql = `
            SELECT
                c.*,
                co.client_name,
                ca.campaign_name
            FROM voicebot_calls c
            LEFT JOIN voicebot_contacts co ON c.contact_id = co.id
            LEFT JOIN voicebot_campaigns ca ON c.campaign_id = ca.id
            ORDER BY c.call_start DESC
            LIMIT ?
        `;
        return await database.query(sql, [limit]);
    }

    async updateCallStatus(callId, status, endTime = null) {
        const updateData = { call_status: status };

        if (endTime) {
            updateData.call_end = endTime;
            const call = await this.getCall(callId);
            if (call && call.call_start) {
                const duration = Math.floor((new Date(endTime) - new Date(call.call_start)) / 1000);
                updateData.duration_seconds = duration;
            }
        }

        return await database.update('voicebot_calls', updateData, 'id = ?', [callId]);
    }

    async setCallRecording(callId, recordingPath) {
        return await database.update('voicebot_calls', {
            audio_recording_path: recordingPath
        }, 'id = ?', [callId]);
    }

    // ==================== TRANSCRIPTIONS ====================

    async addTranscription(data) {
        return await database.insert('voicebot_transcriptions', {
            call_id: data.callId,
            sequence_number: data.sequence || 0,
            speaker: data.speaker || 'unknown',
            audio_chunk_path: data.audioPath || null,
            transcription: data.text || null,
            response_text: data.response || null,
            confidence_score: data.confidence || 0,
            processing_time_ms: data.processingTime || 0
        });
    }

    async getTranscriptions(callId) {
        return await database.findAll('voicebot_transcriptions', 'call_id = ?', [callId], 'sequence_number ASC');
    }

    async getFullConversation(callId) {
        const transcriptions = await this.getTranscriptions(callId);

        return transcriptions.map(t => ({
            speaker: t.speaker,
            text: t.transcription,
            response: t.response_text,
            timestamp: t.timestamp
        }));
    }

    // ==================== APPOINTMENTS ====================

    async createAppointment(appointmentData) {
        let interestLevel = appointmentData.interestLevel || 'medium';
        if (interestLevel === 'none') interestLevel = 'low';

        return await database.insert('voicebot_appointments', {
            call_id: appointmentData.callId || null,
            contact_id: appointmentData.contactId || null,
            campaign_id: appointmentData.campaignId || null,
            phone_number: appointmentData.phoneNumber || null,
            client_name: appointmentData.clientName || null,
            appointment_date: appointmentData.date || null,
            appointment_time: appointmentData.time || null,
            appointment_notes: appointmentData.notes || null,
            interest_level: interestLevel,
            agreement_reached: appointmentData.agreementReached ? 1 : 0,
            status: 'scheduled'
        });
    }

    async getAppointment(appointmentId) {
        return await database.findOne('voicebot_appointments', 'id = ?', [appointmentId]);
    }

    async getAppointmentsByCall(callId) {
        return await database.findAll('voicebot_appointments', 'call_id = ?', [callId]);
    }

    async getAppointmentsByCampaign(campaignId) {
        const sql = `
            SELECT
                a.*,
                co.client_name,
                co.phone_number,
                co.property_type,
                co.property_location,
                co.property_size,
                co.property_price,
                ca.call_start,
                ca.duration_seconds,
                c.campaign_name
            FROM voicebot_appointments a
            LEFT JOIN voicebot_contacts co ON a.contact_id = co.id
            LEFT JOIN voicebot_calls ca ON a.call_id = ca.id
            LEFT JOIN voicebot_campaigns c ON a.campaign_id = c.id
            WHERE a.campaign_id = ?
            ORDER BY a.created_at DESC
        `;
        return await database.query(sql, [campaignId]);
    }

    async getAllAppointments(limit = 100) {
        const sql = `
            SELECT
                a.*,
                co.client_name,
                co.phone_number,
                co.property_type,
                co.property_location,
                co.property_price,
                c.campaign_name,
                cl.call_start,
                cl.duration_seconds
            FROM voicebot_appointments a
            LEFT JOIN voicebot_contacts co ON a.contact_id = co.id
            LEFT JOIN voicebot_campaigns c ON a.campaign_id = c.id
            LEFT JOIN voicebot_calls cl ON a.call_id = cl.id
            ORDER BY a.created_at DESC
            LIMIT ?
        `;
        return await database.query(sql, [limit]);
    }

    async getUpcomingAppointments(days = 7) {
        const sql = `
            SELECT
                a.*,
                co.client_name,
                co.phone_number,
                c.campaign_name
            FROM voicebot_appointments a
            LEFT JOIN voicebot_contacts co ON a.contact_id = co.id
            LEFT JOIN voicebot_campaigns c ON a.campaign_id = c.id
            WHERE a.appointment_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
            AND a.status = 'scheduled'
            ORDER BY a.appointment_date ASC, a.appointment_time ASC
        `;
        return await database.query(sql, [days]);
    }

    async updateAppointmentStatus(appointmentId, status) {
        return await database.update('voicebot_appointments', { status }, 'id = ?', [appointmentId]);
    }

    async updateAppointment(appointmentId, data) {
        const updateData = {};

        if (data.date) updateData.appointment_date = data.date;
        if (data.time) updateData.appointment_time = data.time;
        if (data.notes) updateData.appointment_notes = data.notes;
        if (data.status) updateData.status = data.status;
        if (data.interestLevel) updateData.interest_level = data.interestLevel;

        return await database.update('voicebot_appointments', updateData, 'id = ?', [appointmentId]);
    }

    async deleteAppointment(appointmentId) {
        return await database.delete('voicebot_appointments', 'id = ?', [appointmentId]);
    }

    // ==================== STATISTICS ====================

    async getCampaignStats(campaignId) {
        const sql = `
            SELECT
                c.id,
                c.campaign_name,
                c.status,
                c.created_at,
                c.started_at,
                c.completed_at,
                COUNT(DISTINCT co.id) as total_contacts,
                COUNT(DISTINCT CASE WHEN co.call_status = 'completed' THEN co.id END) as calls_completed,
                COUNT(DISTINCT CASE WHEN co.call_status = 'failed' THEN co.id END) as calls_failed,
                COUNT(DISTINCT CASE WHEN co.call_status = 'pending' THEN co.id END) as calls_pending,
                COUNT(DISTINCT CASE WHEN co.call_status = 'no_answer' THEN co.id END) as calls_no_answer,
                COUNT(DISTINCT a.id) as appointments_scheduled,
                AVG(CASE WHEN ca.duration_seconds > 0 THEN ca.duration_seconds END) as avg_call_duration
            FROM voicebot_campaigns c
            LEFT JOIN voicebot_contacts co ON c.id = co.campaign_id
            LEFT JOIN voicebot_calls ca ON c.id = ca.campaign_id
            LEFT JOIN voicebot_appointments a ON c.id = a.campaign_id
            WHERE c.id = ?
            GROUP BY c.id
        `;

        const results = await database.query(sql, [campaignId]);
        return results[0] || null;
    }

    async getGlobalStats() {
        const sql = `
            SELECT
                COUNT(DISTINCT c.id) as total_campaigns,
                COUNT(DISTINCT co.id) as total_contacts,
                COUNT(DISTINCT ca.id) as total_calls,
                COUNT(DISTINCT a.id) as total_appointments,
                AVG(CASE WHEN ca.duration_seconds > 0 THEN ca.duration_seconds END) as avg_call_duration,
                COUNT(DISTINCT CASE WHEN c.status = 'running' THEN c.id END) as active_campaigns
            FROM voicebot_campaigns c
            LEFT JOIN voicebot_contacts co ON c.id = co.campaign_id
            LEFT JOIN voicebot_calls ca ON c.id = ca.campaign_id
            LEFT JOIN voicebot_appointments a ON c.id = a.campaign_id
        `;
        const results = await database.query(sql);
        return results[0] || null;
    }

    async getTodayStats() {
        const sql = `
            SELECT
                COUNT(DISTINCT ca.id) as calls_today,
                COUNT(DISTINCT a.id) as appointments_today,
                AVG(CASE WHEN ca.duration_seconds > 0 THEN ca.duration_seconds END) as avg_duration_today
            FROM voicebot_calls ca
            LEFT JOIN voicebot_appointments a ON ca.id = a.call_id AND DATE(a.created_at) = CURDATE()
            WHERE DATE(ca.call_start) = CURDATE()
        `;
        const results = await database.query(sql);
        return results[0] || null;
    }
}

module.exports = new VoicebotDatabase();
