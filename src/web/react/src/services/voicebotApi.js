import axios from 'axios';

const API_BASE_URL = '/api/voicebot';

const voicebotApi = {
    // ========== CAMPAÑAS ==========

    async createCampaign(campaignName, csvFile) {
        const formData = new FormData();
        formData.append('campaignName', campaignName);
        formData.append('csv', csvFile);

        const response = await axios.post(`${API_BASE_URL}/campaigns/create`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });

        return response.data;
    },

    async getCampaigns() {
        const response = await axios.get(`${API_BASE_URL}/campaigns`);
        return response.data.campaigns;
    },

    async getCampaign(campaignId) {
        const response = await axios.get(`${API_BASE_URL}/campaigns/${campaignId}`);
        return response.data.campaign;
    },

    async getCampaignStats(campaignId) {
        const response = await axios.get(`${API_BASE_URL}/campaigns/${campaignId}/stats`);
        return response.data.stats;
    },

    async startCampaign(campaignId) {
        const response = await axios.post(`${API_BASE_URL}/campaigns/${campaignId}/start`);
        return response.data;
    },

    async pauseCampaign(campaignId) {
        const response = await axios.post(`${API_BASE_URL}/campaigns/${campaignId}/pause`);
        return response.data;
    },

    async stopCampaign(campaignId) {
        const response = await axios.post(`${API_BASE_URL}/campaigns/${campaignId}/stop`);
        return response.data;
    },

    async deleteCampaign(campaignId) {
        const response = await axios.delete(`${API_BASE_URL}/campaigns/${campaignId}`);
        return response.data;
    },

    // ========== LLAMADAS ==========

    async getCampaignCalls(campaignId) {
        const response = await axios.get(`${API_BASE_URL}/campaigns/${campaignId}/calls`);
        return response.data.calls;
    },

    async getCallTranscription(callId) {
        const response = await axios.get(`${API_BASE_URL}/calls/${callId}/transcription`);
        return response.data.transcription;
    },

    // ========== CITAS ==========

    async getAllAppointments() {
        const response = await axios.get(`${API_BASE_URL}/appointments`);
        return response.data.appointments;
    },

    async getCampaignAppointments(campaignId) {
        const response = await axios.get(`${API_BASE_URL}/campaigns/${campaignId}/appointments`);
        return response.data.appointments;
    },

    async updateAppointmentStatus(appointmentId, status) {
        const response = await axios.put(`${API_BASE_URL}/appointments/${appointmentId}/status`, {
            status
        });
        return response.data;
    },

    async updateAppointment(appointmentId, appointmentData) {
        const response = await axios.put(`${API_BASE_URL}/appointments/${appointmentId}`, appointmentData);
        return response.data;
    },

    async deleteAppointment(appointmentId) {
        const response = await axios.delete(`${API_BASE_URL}/appointments/${appointmentId}`);
        return response.data;
    },

    // ========== CONFIGURACIÓN ==========

    async getConfig() {
        const response = await axios.get(`${API_BASE_URL}/config`);
        return response.data.config;
    },

    async updateConfig(config) {
        for (const [key, value] of Object.entries(config)) {
            await axios.put(`${API_BASE_URL}/config`, {
                key,
                value
            });
        }
        return { success: true };
    },

    // ========== ESTADO ==========

    async getStatus() {
        const response = await axios.get(`${API_BASE_URL}/status`);
        return response.data;
    }
};

export default voicebotApi;
