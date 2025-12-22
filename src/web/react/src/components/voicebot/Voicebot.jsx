import { useState, useEffect, useRef } from 'react';
import { Phone, Upload, Calendar } from 'lucide-react';
import voicebotApi from '../../services/voicebotApi';
import CampaignCreate from './CampaignCreate';
import CampaignList from './CampaignList';
import CampaignDetails from './CampaignDetails';
import AppointmentsList from './AppointmentsList';
import ActiveCallsFloat from './ActiveCallsFloat';

function Voicebot() {
    const [activeTab, setActiveTab] = useState('campaigns');
    const [campaigns, setCampaigns] = useState([]);
    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    const intervalRef = useRef(null);

    useEffect(() => {
        fetchInitialData();

        // Polling dinámico: más rápido si hay llamadas activas
        const startPolling = () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            const pollInterval = status?.activeCallsCount > 0 ? 1000 : 5000;
            intervalRef.current = setInterval(() => {
                fetchStatus();
                fetchCampaigns(); // También actualizar campañas para el progreso
            }, pollInterval);
        };

        startPolling();
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [status?.activeCallsCount]);

    const fetchInitialData = async () => {
        try {
            await Promise.all([
                fetchCampaigns(),
                fetchStatus()
            ]);
        } catch (error) {
            console.error('Error cargando datos:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchCampaigns = async () => {
        try {
            const campaignsData = await voicebotApi.getCampaigns();
            setCampaigns(campaignsData || []);
        } catch (error) {
            console.error('Error cargando campañas:', error);
            setCampaigns([]);
        }
    };

    const fetchStatus = async () => {
        try {
            const statusData = await voicebotApi.getStatus();
            setStatus(statusData);
        } catch (error) {
            console.error('Error cargando estado:', error);
        }
    };

    const handleCampaignCreated = () => {
        fetchCampaigns();
        setActiveTab('campaigns');
    };

    const handleSelectCampaign = (campaign) => {
        setSelectedCampaign(campaign);
        setActiveTab('details');
    };

    const tabs = [
        { id: 'campaigns', label: 'Campañas', icon: Phone },
        { id: 'create', label: 'Nueva Campaña', icon: Upload },
        { id: 'appointments', label: 'Citas', icon: Calendar }
    ];

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navetec-primary mx-auto mb-4"></div>
                    <p className="text-gray-600">Cargando Voicebot...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 bg-white min-h-screen overflow-y-auto">
            {/* Header con estado del sistema */}
            <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-3xl font-bold text-gray-800 flex items-center">
                        <Phone className="h-8 w-8 mr-3 text-navetec-primary" />
                        Voicebot - Llamadas Automatizadas
                    </h1>

                    {status && (
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center">
                                <div className={`h-3 w-3 rounded-full mr-2 ${
                                    status.asteriskConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                                }`}></div>
                                <span className="text-sm text-gray-600">
                                    {status.asteriskConnected ? 'Asterisk Conectado' : 'Asterisk Desconectado'}
                                </span>
                            </div>
                            {status.activeCallsCount > 0 && (
                                <div className="bg-green-100 px-3 py-1 rounded-full animate-pulse">
                                    <span className="text-sm font-semibold text-green-800">
                                        {status.activeCallsCount} llamada{status.activeCallsCount !== 1 ? 's' : ''} en curso
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-200">
                    <div className="flex space-x-1">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center px-4 py-3 font-medium text-sm border-b-2 transition-colors ${
                                        activeTab === tab.id
                                            ? 'border-navetec-primary text-navetec-primary'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                                >
                                    <Icon className="h-4 w-4 mr-2" />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="mt-6">
                {activeTab === 'campaigns' && (
                    <CampaignList
                        campaigns={campaigns}
                        onSelectCampaign={handleSelectCampaign}
                        onRefresh={fetchCampaigns}
                    />
                )}

                {activeTab === 'create' && (
                    <CampaignCreate
                        onCampaignCreated={handleCampaignCreated}
                    />
                )}

                {activeTab === 'details' && selectedCampaign && (
                    <CampaignDetails
                        campaign={selectedCampaign}
                        onBack={() => setActiveTab('campaigns')}
                        onUpdate={fetchCampaigns}
                    />
                )}

                {activeTab === 'appointments' && (
                    <AppointmentsList />
                )}
            </div>

            {/* Componente flotante de llamadas activas */}
            <ActiveCallsFloat activeCallsCount={status?.activeCallsCount || 0} />
        </div>
    );
}

export default Voicebot;
