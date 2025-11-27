import { useState } from 'react';
import { Phone, Users, Calendar, RefreshCw, Trash2 } from 'lucide-react';
import voicebotApi from '../../services/voicebotApi';

function CampaignList({ campaigns, onSelectCampaign, onRefresh }) {
    const [deletingId, setDeletingId] = useState(null);

    const handleDelete = async (e, campaignId, campaignName, campaignStatus) => {
        e.stopPropagation();

        if (campaignStatus === 'running') {
            alert('No se puede eliminar una campaña activa. Primero detén la campaña.');
            return;
        }

        if (!confirm(`¿Estás seguro de eliminar la campaña "${campaignName}"?\n\nEsto eliminará toda la información asociada: contactos, llamadas, transcripciones y citas.`)) {
            return;
        }

        setDeletingId(campaignId);

        try {
            await voicebotApi.deleteCampaign(campaignId);
            onRefresh();
        } catch (error) {
            console.error('Error eliminando campaña:', error);
            alert(error.response?.data?.error || 'Error eliminando campaña');
        } finally {
            setDeletingId(null);
        }
    };

    const getStatusBadge = (status) => {
        const badges = {
            pending: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Pendiente' },
            running: { bg: 'bg-green-100', text: 'text-green-700', label: 'En ejecución' },
            paused: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Pausada' },
            completed: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Completada' },
            cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: 'Cancelada' }
        };

        const badge = badges[status] || badges.pending;

        return (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
                {badge.label}
            </span>
        );
    };

    if (!campaigns || campaigns.length === 0) {
        return (
            <div className="text-center py-12">
                <Phone className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">No hay campañas creadas aún</p>
                <p className="text-sm text-gray-400">Crea tu primera campaña para comenzar a hacer llamadas automáticas</p>
            </div>
        );
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">
                    Campañas ({campaigns.length})
                </h2>
                <button
                    onClick={onRefresh}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center"
                >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Actualizar
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {campaigns.map((campaign) => (
                    <div
                        key={campaign.id}
                        onClick={() => onSelectCampaign(campaign)}
                        className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-lg transition-shadow cursor-pointer"
                    >
                        {/* Header */}
                        <div className="flex justify-between items-start mb-3">
                            <h3 className="font-bold text-lg text-gray-800 truncate flex-1 mr-2">
                                {campaign.campaign_name}
                            </h3>
                            {getStatusBadge(campaign.status)}
                        </div>

                        {/* Stats */}
                        <div className="space-y-2">
                            <div className="flex items-center text-sm text-gray-600">
                                <Users className="h-4 w-4 mr-2 text-gray-400" />
                                <span>{campaign.total_contacts || 0} contactos</span>
                            </div>

                            <div className="flex items-center text-sm text-gray-600">
                                <Phone className="h-4 w-4 mr-2 text-gray-400" />
                                <span>{campaign.calls_completed || 0} llamadas completadas</span>
                            </div>

                            <div className="flex items-center text-sm text-gray-600">
                                <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                                <span>{campaign.appointments_scheduled || 0} citas agendadas</span>
                            </div>
                        </div>

                        {/* Fecha y Acciones */}
                        <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
                            <p className="text-xs text-gray-500">
                                Creada: {new Date(campaign.created_at).toLocaleDateString('es-MX')}
                            </p>
                            <button
                                onClick={(e) => handleDelete(e, campaign.id, campaign.campaign_name, campaign.status)}
                                disabled={deletingId === campaign.id}
                                className={`p-2 rounded-lg transition-colors ${
                                    campaign.status === 'running'
                                        ? 'text-gray-300 cursor-not-allowed'
                                        : 'text-red-500 hover:bg-red-50'
                                } ${deletingId === campaign.id ? 'opacity-50 cursor-wait' : ''}`}
                                title={campaign.status === 'running' ? 'No se puede eliminar una campaña activa' : 'Eliminar campaña'}
                            >
                                {deletingId === campaign.id ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500"></div>
                                ) : (
                                    <Trash2 className="h-4 w-4" />
                                )}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default CampaignList;
