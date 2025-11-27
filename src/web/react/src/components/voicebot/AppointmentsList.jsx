import React, { useState, useEffect } from 'react';
import { Calendar, User, Phone, MapPin, TrendingUp, CheckCircle, XCircle, Clock, RefreshCw, Edit, Trash2 } from 'lucide-react';
import voicebotApi from '../../services/voicebotApi';

function AppointmentsList() {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [campaigns, setCampaigns] = useState([]);
    const [selectedCampaign, setSelectedCampaign] = useState('all');
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [deletingId, setDeletingId] = useState(null);

    useEffect(() => {
        loadCampaigns();
        loadAppointments();
        const interval = setInterval(loadAppointments, 30000);
        return () => clearInterval(interval);
    }, [selectedCampaign]);

    const loadCampaigns = async () => {
        try {
            const campaigns = await voicebotApi.getCampaigns();
            setCampaigns(campaigns || []);
        } catch (error) {
            console.error('Error cargando campañas:', error);
        }
    };

    const loadAppointments = async () => {
        try {
            setLoading(true);
            let appointments;
            if (selectedCampaign === 'all') {
                appointments = await voicebotApi.getAllAppointments();
            } else {
                appointments = await voicebotApi.getCampaignAppointments(selectedCampaign);
            }
            setAppointments(appointments || []);
        } catch (error) {
            console.error('Error cargando citas:', error);
            setAppointments([]);
        } finally {
            setLoading(false);
        }
    };

    const getInterestColor = (level) => {
        switch (level) {
            case 'high': return 'text-green-600 bg-green-100';
            case 'medium': return 'text-yellow-600 bg-yellow-100';
            case 'low': return 'text-gray-600 bg-gray-100';
            default: return 'text-gray-600 bg-gray-100';
        }
    };

    const getInterestLabel = (level) => {
        switch (level) {
            case 'high': return 'Alto Interés';
            case 'medium': return 'Interés Medio';
            case 'low': return 'Interés Bajo';
            default: return 'Sin Definir';
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Por confirmar';
        const date = new Date(dateString);
        return date.toLocaleDateString('es-MX', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const formatTime = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleEdit = (appointment) => {
        setEditingId(appointment.id);
        setEditForm({
            client_name: appointment.client_name,
            phone_number: appointment.phone_number,
            appointment_date: appointment.appointment_date?.split('T')[0] || '',
            appointment_time: appointment.appointment_time || '',
            property_location: appointment.property_location || '',
            appointment_notes: appointment.analysis_notes || ''
        });
    };

    const handleSaveEdit = async () => {
        try {
            await voicebotApi.updateAppointment(editingId, editForm);
            setEditingId(null);
            setEditForm({});
            loadAppointments();
        } catch (error) {
            console.error('Error actualizando cita:', error);
            alert('Error actualizando cita');
        }
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditForm({});
    };

    const handleDelete = async (appointmentId) => {
        if (!confirm('¿Estás seguro de eliminar esta cita? Esta acción no se puede deshacer.')) return;

        setDeletingId(appointmentId);
        try {
            await voicebotApi.deleteAppointment(appointmentId);
            loadAppointments();
        } catch (error) {
            console.error('Error eliminando cita:', error);
            alert('Error eliminando cita');
        } finally {
            setDeletingId(null);
        }
    };

    const filteredAppointments = appointments.filter(apt => {
        if (filter === 'all') return true;
        return apt.interest_level === filter;
    });

    const stats = {
        total: appointments.length,
        high: appointments.filter(a => a.interest_level === 'high').length,
        medium: appointments.filter(a => a.interest_level === 'medium').length,
        low: appointments.filter(a => a.interest_level === 'low').length,
        agreements: appointments.filter(a => a.agreement_reached).length
    };

    if (loading && appointments.length === 0) {
        return (
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-8 w-8 text-navetec-primary animate-spin mr-3" />
                    <span className="text-gray-600">Cargando citas agendadas...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow">
            {/* Header con Stats */}
            <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">
                        Citas Agendadas
                    </h2>
                    <button
                        onClick={loadAppointments}
                        className="flex items-center space-x-2 px-4 py-2 text-sm text-gray-600 hover:text-navetec-primary border border-gray-300 rounded-md hover:border-navetec-primary transition-colors"
                    >
                        <RefreshCw className="h-4 w-4" />
                        <span>Actualizar</span>
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-5 gap-4 mb-6">
                    <div className="bg-blue-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <Calendar className="h-8 w-8 text-blue-600" />
                            <div className="text-right">
                                <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
                                <div className="text-xs text-blue-600">Total Citas</div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <TrendingUp className="h-8 w-8 text-green-600" />
                            <div className="text-right">
                                <div className="text-2xl font-bold text-green-600">{stats.high}</div>
                                <div className="text-xs text-green-600">Alto Interés</div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-yellow-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <TrendingUp className="h-8 w-8 text-yellow-600" />
                            <div className="text-right">
                                <div className="text-2xl font-bold text-yellow-600">{stats.medium}</div>
                                <div className="text-xs text-yellow-600">Interés Medio</div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <TrendingUp className="h-8 w-8 text-gray-600" />
                            <div className="text-right">
                                <div className="text-2xl font-bold text-gray-600">{stats.low}</div>
                                <div className="text-xs text-gray-600">Interés Bajo</div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <CheckCircle className="h-8 w-8 text-purple-600" />
                            <div className="text-right">
                                <div className="text-2xl font-bold text-purple-600">{stats.agreements}</div>
                                <div className="text-xs text-purple-600">Acuerdos</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Filtros */}
                <div className="flex items-center space-x-4">
                    <select
                        value={selectedCampaign}
                        onChange={(e) => setSelectedCampaign(e.target.value)}
                        className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-navetec-primary focus:border-navetec-primary"
                    >
                        <option value="all">Todas las campañas</option>
                        {campaigns.map(campaign => (
                            <option key={campaign.id} value={campaign.id}>
                                {campaign.campaign_name}
                            </option>
                        ))}
                    </select>

                    <div className="flex space-x-2">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                filter === 'all'
                                    ? 'bg-navetec-primary text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            Todas ({stats.total})
                        </button>
                        <button
                            onClick={() => setFilter('high')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                filter === 'high'
                                    ? 'bg-green-600 text-white'
                                    : 'bg-green-100 text-green-600 hover:bg-green-200'
                            }`}
                        >
                            Alto ({stats.high})
                        </button>
                        <button
                            onClick={() => setFilter('medium')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                filter === 'medium'
                                    ? 'bg-yellow-600 text-white'
                                    : 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200'
                            }`}
                        >
                            Medio ({stats.medium})
                        </button>
                        <button
                            onClick={() => setFilter('low')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                                filter === 'low'
                                    ? 'bg-gray-600 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            Bajo ({stats.low})
                        </button>
                    </div>
                </div>
            </div>

            {/* Lista de Citas */}
            <div className="divide-y divide-gray-200">
                {filteredAppointments.length === 0 ? (
                    <div className="p-12 text-center">
                        <Calendar className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg mb-2">No hay citas agendadas</p>
                        <p className="text-gray-400 text-sm">
                            {filter !== 'all'
                                ? 'Prueba con otro filtro'
                                : 'Las citas aparecerán aquí cuando el voicebot complete llamadas exitosas'
                            }
                        </p>
                    </div>
                ) : (
                    filteredAppointments.map((appointment) => (
                        <div key={appointment.id} className="p-6 hover:bg-gray-50 transition-colors">
                            {editingId === appointment.id ? (
                                <div className="bg-white border-2 border-navetec-primary rounded-lg p-4">
                                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Editar Cita</h3>
                                    <div className="grid grid-cols-2 gap-4 mb-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Nombre del Cliente
                                            </label>
                                            <input
                                                type="text"
                                                value={editForm.client_name || ''}
                                                onChange={(e) => setEditForm({...editForm, client_name: e.target.value})}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-navetec-primary focus:border-navetec-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Teléfono
                                            </label>
                                            <input
                                                type="text"
                                                value={editForm.phone_number || ''}
                                                onChange={(e) => setEditForm({...editForm, phone_number: e.target.value})}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-navetec-primary focus:border-navetec-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Fecha de Cita
                                            </label>
                                            <input
                                                type="date"
                                                value={editForm.appointment_date || ''}
                                                onChange={(e) => setEditForm({...editForm, appointment_date: e.target.value})}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-navetec-primary focus:border-navetec-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Hora de Cita
                                            </label>
                                            <input
                                                type="time"
                                                value={editForm.appointment_time || ''}
                                                onChange={(e) => setEditForm({...editForm, appointment_time: e.target.value})}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-navetec-primary focus:border-navetec-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Ubicación
                                            </label>
                                            <input
                                                type="text"
                                                value={editForm.property_location || ''}
                                                onChange={(e) => setEditForm({...editForm, property_location: e.target.value})}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-navetec-primary focus:border-navetec-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Notas
                                            </label>
                                            <input
                                                type="text"
                                                value={editForm.appointment_notes || ''}
                                                onChange={(e) => setEditForm({...editForm, appointment_notes: e.target.value})}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-navetec-primary focus:border-navetec-primary"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex justify-end space-x-2">
                                        <button
                                            onClick={handleCancelEdit}
                                            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 border border-gray-300 rounded-md transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={handleSaveEdit}
                                            className="px-4 py-2 text-sm text-white bg-navetec-primary hover:bg-navetec-primary-dark rounded-md transition-colors"
                                        >
                                            Guardar Cambios
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center space-x-3 mb-3">
                                            <h3 className="text-lg font-semibold text-gray-900">
                                                {appointment.client_name}
                                            </h3>
                                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getInterestColor(appointment.interest_level)}`}>
                                                {getInterestLabel(appointment.interest_level)}
                                            </span>
                                            {appointment.agreement_reached && (
                                                <span className="px-3 py-1 rounded-full text-xs font-medium text-green-600 bg-green-100 flex items-center space-x-1">
                                                    <CheckCircle className="h-3 w-3" />
                                                    <span>Acuerdo Alcanzado</span>
                                                </span>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 mb-3">
                                            <div className="flex items-center text-sm text-gray-600">
                                                <Phone className="h-4 w-4 mr-2 text-gray-400" />
                                                <span>{appointment.phone_number}</span>
                                            </div>
                                            <div className="flex items-center text-sm text-gray-600">
                                                <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                                                <span>{formatDate(appointment.appointment_date)}</span>
                                                {appointment.appointment_time && (
                                                    <span className="ml-2 text-navetec-primary font-medium">
                                                        {appointment.appointment_time}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center text-sm text-gray-600">
                                                <MapPin className="h-4 w-4 mr-2 text-gray-400" />
                                                <span>{appointment.property_location || 'Sin ubicación'}</span>
                                            </div>
                                            <div className="flex items-center text-sm text-gray-600">
                                                <Clock className="h-4 w-4 mr-2 text-gray-400" />
                                                <span>
                                                    Llamada: {appointment.call_start
                                                        ? new Date(appointment.call_start).toLocaleDateString('es-MX')
                                                        : new Date(appointment.created_at).toLocaleDateString('es-MX')}
                                                    {appointment.duration_seconds ? ` - ${appointment.duration_seconds}s` : ''}
                                                </span>
                                            </div>
                                            {appointment.property_type && (
                                                <div className="flex items-center text-sm text-gray-600">
                                                    <span className="font-medium text-gray-500 mr-2">Tipo:</span>
                                                    <span>{appointment.property_type}</span>
                                                </div>
                                            )}
                                            {appointment.property_price && (
                                                <div className="flex items-center text-sm text-gray-600">
                                                    <span className="font-medium text-gray-500 mr-2">Precio:</span>
                                                    <span className="text-green-600 font-medium">{appointment.property_price}</span>
                                                </div>
                                            )}
                                        </div>

                                        {appointment.analysis_notes && (
                                            <div className="bg-blue-50 rounded-lg p-3 mb-3">
                                                <div className="text-xs font-medium text-blue-700 mb-1">
                                                    Análisis de la conversación:
                                                </div>
                                                <p className="text-sm text-blue-900">{appointment.analysis_notes}</p>
                                            </div>
                                        )}

                                        <div className="flex items-center space-x-2 mt-4">
                                            <button
                                                onClick={() => handleEdit(appointment)}
                                                className="flex items-center space-x-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 border border-blue-300 rounded-md transition-colors"
                                            >
                                                <Edit className="h-4 w-4" />
                                                <span>Editar</span>
                                            </button>
                                            <button
                                                onClick={() => handleDelete(appointment.id)}
                                                disabled={deletingId === appointment.id}
                                                className="flex items-center space-x-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 border border-red-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                <span>{deletingId === appointment.id ? 'Eliminando...' : 'Eliminar'}</span>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="ml-6 text-right">
                                        <div className="text-xs text-gray-500 mb-1">Campaña</div>
                                        <div className="text-sm font-medium text-gray-700">
                                            {appointment.campaign_name}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default AppointmentsList;
