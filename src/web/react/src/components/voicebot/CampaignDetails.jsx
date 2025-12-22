import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, Pause, Square, Phone, Users, Clock, RefreshCw } from 'lucide-react';
import voicebotApi from '../../services/voicebotApi';

function CampaignDetails({ campaign, onBack, onUpdate }) {
    const [stats, setStats] = useState(null);
    const [currentCampaign, setCurrentCampaign] = useState(campaign);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const intervalRef = useRef(null);

    useEffect(() => {
        fetchStats();
        fetchCampaignData();

        // Polling: cada segundo si está corriendo, cada 5 si no
        const startPolling = () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            const isRunning = currentCampaign.status === 'running';
            const pollInterval = isRunning ? 1000 : 5000;

            intervalRef.current = setInterval(() => {
                fetchStats();
                fetchCampaignData();
            }, pollInterval);
        };

        startPolling();

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [campaign.id, currentCampaign.status]);

    const fetchCampaignData = async () => {
        try {
            const campaignData = await voicebotApi.getCampaign(campaign.id);
            if (campaignData) {
                setCurrentCampaign(campaignData);
            }
        } catch (error) {
            console.error('Error cargando campaña:', error);
        }
    };

    const fetchStats = async () => {
        try {
            const statsData = await voicebotApi.getCampaignStats(campaign.id);
            setStats(statsData);
        } catch (error) {
            console.error('Error cargando estadísticas:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleStart = async () => {
        setActionLoading(true);
        // Actualización optimista: cambiar el estado inmediatamente
        setCurrentCampaign(prev => ({ ...prev, status: 'running' }));
        try {
            await voicebotApi.startCampaign(currentCampaign.id);
            await onUpdate();
            await fetchStats();
            await fetchCampaignData();
        } catch (error) {
            console.error('Error iniciando campaña:', error);
            // Revertir si hay error
            await fetchCampaignData();
            alert(error.response?.data?.error || 'Error iniciando campaña');
        } finally {
            setActionLoading(false);
        }
    };

    const handlePause = async () => {
        setActionLoading(true);
        // Actualización optimista
        setCurrentCampaign(prev => ({ ...prev, status: 'paused' }));
        try {
            await voicebotApi.pauseCampaign(currentCampaign.id);
            await onUpdate();
            await fetchStats();
            await fetchCampaignData();
        } catch (error) {
            console.error('Error pausando campaña:', error);
            await fetchCampaignData();
            alert(error.response?.data?.error || 'Error pausando campaña');
        } finally {
            setActionLoading(false);
        }
    };

    const handleStop = async () => {
        if (!confirm('¿Estás seguro de detener esta campaña?')) return;

        setActionLoading(true);
        try {
            await voicebotApi.stopCampaign(currentCampaign.id);
            await onUpdate();
            onBack();
        } catch (error) {
            console.error('Error deteniendo campaña:', error);
            alert(error.response?.data?.error || 'Error deteniendo campaña');
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return <div>Cargando...</div>;
    }

    const progress = stats?.total_contacts > 0
        ? Math.round((stats.calls_completed / stats.total_contacts) * 100)
        : 0;

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <button
                    onClick={onBack}
                    className="flex items-center text-gray-600 hover:text-gray-800"
                >
                    <ArrowLeft className="h-5 w-5 mr-2" />
                    Volver
                </button>

                <div className="flex space-x-2 items-center">
                    {/* Indicador de estado */}
                    <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                        currentCampaign.status === 'running' ? 'bg-green-100 text-green-800 animate-pulse' :
                        currentCampaign.status === 'paused' ? 'bg-yellow-100 text-yellow-800' :
                        currentCampaign.status === 'completed' ? 'bg-gray-100 text-gray-800' :
                        'bg-blue-100 text-blue-800'
                    }`}>
                        {currentCampaign.status === 'running' ? 'En ejecución' :
                         currentCampaign.status === 'paused' ? 'Pausada' :
                         currentCampaign.status === 'completed' ? 'Completada' : 'Pendiente'}
                    </div>

                    {currentCampaign.status === 'pending' && (
                        <button
                            onClick={handleStart}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center transition-all"
                        >
                            {actionLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                            Iniciar Campaña
                        </button>
                    )}

                    {currentCampaign.status === 'running' && (
                        <button
                            onClick={handlePause}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 flex items-center transition-all"
                        >
                            {actionLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Pause className="h-4 w-4 mr-2" />}
                            Pausar
                        </button>
                    )}

                    {currentCampaign.status === 'paused' && (
                        <button
                            onClick={handleStart}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center transition-all"
                        >
                            {actionLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                            Reanudar
                        </button>
                    )}

                    {(currentCampaign.status === 'running' || currentCampaign.status === 'paused') && (
                        <button
                            onClick={handleStop}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center transition-all"
                        >
                            {actionLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Square className="h-4 w-4 mr-2" />}
                            Detener
                        </button>
                    )}
                </div>
            </div>

            {/* Campaign Info */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h1 className="text-2xl font-bold text-gray-800 mb-4">{currentCampaign.campaign_name}</h1>

                {/* Progress Bar */}
                <div className="mb-6">
                    <div className="flex justify-between text-sm text-gray-600 mb-2">
                        <span>Progreso de llamadas</span>
                        <span>{progress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                        <div
                            className="bg-navetec-primary h-3 rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="flex items-center mb-2">
                            <Users className="h-5 w-5 text-blue-600 mr-2" />
                            <span className="text-sm text-gray-600">Total Contactos</span>
                        </div>
                        <p className="text-2xl font-bold text-blue-900">{stats?.total_contacts || 0}</p>
                    </div>

                    <div className="bg-green-50 p-4 rounded-lg">
                        <div className="flex items-center mb-2">
                            <Phone className="h-5 w-5 text-green-600 mr-2" />
                            <span className="text-sm text-gray-600">Completadas</span>
                        </div>
                        <p className="text-2xl font-bold text-green-900">{stats?.calls_completed || 0}</p>
                    </div>

                    <div className="bg-yellow-50 p-4 rounded-lg">
                        <div className="flex items-center mb-2">
                            <Clock className="h-5 w-5 text-yellow-600 mr-2" />
                            <span className="text-sm text-gray-600">Pendientes</span>
                        </div>
                        <p className="text-2xl font-bold text-yellow-900">{stats?.calls_pending || 0}</p>
                    </div>

                    <div className="bg-purple-50 p-4 rounded-lg">
                        <div className="flex items-center mb-2">
                            <Phone className="h-5 w-5 text-purple-600 mr-2" />
                            <span className="text-sm text-gray-600">Citas</span>
                        </div>
                        <p className="text-2xl font-bold text-purple-900">{stats?.appointments_scheduled || 0}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default CampaignDetails;
