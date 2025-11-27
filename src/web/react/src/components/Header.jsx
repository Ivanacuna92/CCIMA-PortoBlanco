import React from 'react';

function Header({ currentView, onViewChange, user, onLogout }) {
  return (
    <header className="bg-white border-b border-gray-200 px-8 py-4">
      <div className="flex justify-between items-center">
        <img src="/logoportoblanco.png" alt="Porto Blanco" className="h-10" />
        <nav className="flex gap-1">
          {user?.role === 'admin' && (
            <button 
              className={`px-8 py-2 rounded-md font-medium transition-all ${
                currentView === 'dashboard' 
                  ? 'bg-navetec-primary text-white' 
                  : 'text-gray-600 hover:text-navetec-primary'
              }`}
              onClick={() => onViewChange('dashboard')}
            >
              Dashboard
            </button>
          )}
          <button 
            className={`px-8 py-2 rounded-md font-medium transition-all ${
              currentView === 'reports' 
                ? 'bg-navetec-primary text-white' 
                : 'text-gray-600 hover:text-navetec-primary'
            }`}
            onClick={() => onViewChange('reports')}
          >
            Reportes
          </button>
          <button 
            className={`px-8 py-2 rounded-md font-medium transition-all ${
              currentView === 'contacts' 
                ? 'bg-navetec-primary text-white' 
                : 'text-gray-600 hover:text-navetec-primary'
            }`}
            onClick={() => onViewChange('contacts')}
          >
            Contactos
          </button>
          {user?.role === 'admin' && (
            <button
              className={`px-8 py-2 rounded-md font-medium transition-all ${
                currentView === 'terrenos'
                  ? 'bg-navetec-primary text-white'
                  : 'text-gray-600 hover:text-navetec-primary'
              }`}
              onClick={() => onViewChange('terrenos')}
            >
              Terrenos
            </button>
          )}
          {user?.role === 'admin' && (
            <button
              className={`px-8 py-2 rounded-md font-medium transition-all ${
                currentView === 'voicebot'
                  ? 'bg-navetec-primary text-white'
                  : 'text-gray-600 hover:text-navetec-primary'
              }`}
              onClick={() => onViewChange('voicebot')}
            >
              VoiceBot
            </button>
          )}
        </nav>
        
        {user && (
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-600">
              <span className="font-medium">{user.name}</span>
              <span className="text-xs block text-gray-400">{user.role === 'admin' ? 'Administrador' : 'Soporte'}</span>
            </div>
            <button
              onClick={onLogout}
              className="px-4 py-2 text-sm text-gray-600 hover:text-red-600 border border-gray-300 rounded-md hover:border-red-300 transition-colors"
            >
              Cerrar Sesión
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;