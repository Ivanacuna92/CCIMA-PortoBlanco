import React, { useState, useEffect } from 'react';
import ContactsList from './components/ContactsList';
import ChatPanel from './components/ChatPanel';
import Dashboard from './components/Dashboard';
import Reports from './components/Reports';
import TerrenosUpload from './components/TerrenosUpload';
import Header from './components/Header';
import Login from './components/Login';
import { checkAuth, logout } from './services/api';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState(null);
  const [contacts, setContacts] = useState([]);
  // Obtener la vista guardada del localStorage o usar vista por defecto según rol
  const [currentView, setCurrentView] = useState(() => {
    return localStorage.getItem('currentView') || 'contacts';
  });

  // Verificar autenticación al cargar la app
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const authResult = await checkAuth();
      if (authResult && authResult.user) {
        setUser(authResult.user);
        // También guardar en localStorage para acceso desde otros componentes
        localStorage.setItem('currentUser', JSON.stringify(authResult.user));
      }
    } catch (error) {
      // Usuario no autenticado
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    // Guardar datos del usuario en localStorage para acceso global
    localStorage.setItem('currentUser', JSON.stringify(userData));
    // Establecer vista por defecto según rol
    const defaultView = userData.role === 'admin' ? 'dashboard' : 'contacts';
    setCurrentView(defaultView);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      // Error silencioso
    } finally {
      setUser(null);
      setSelectedContact(null);
      setContacts([]);
      localStorage.removeItem('currentUser');
    }
  };

  // Guardar la vista actual en localStorage cuando cambie
  useEffect(() => {
    localStorage.setItem('currentView', currentView);
  }, [currentView]);

  // Escuchar eventos para mostrar chat desde reportes
  React.useEffect(() => {
    const handleShowChat = (event) => {
      const contact = event.detail;
      
      // Asegurarse de que el contacto tenga la estructura correcta
      const formattedContact = {
        ...contact,
        phone: contact.phone || 'Sin número',
        messages: contact.messages || [],
        totalMessages: contact.totalMessages || 0,
        userMessages: contact.userMessages || 0,
        botMessages: contact.botMessages || 0,
        firstContact: contact.firstContact || new Date().toISOString(),
        lastActivity: contact.lastActivity || new Date().toISOString(),
        isHumanMode: contact.isHumanMode || false,
        mode: contact.mode || 'ai'
      };
      
      setSelectedContact(formattedContact);
      
      // Actualizar o agregar el contacto a la lista
      setContacts(prev => {
        const existing = prev.find(c => c.phone === formattedContact.phone);
        if (existing) {
          return prev.map(c => c.phone === formattedContact.phone ? formattedContact : c);
        } else {
          return [formattedContact, ...prev];
        }
      });
      
      setCurrentView('contacts');
    };

    window.addEventListener('showChat', handleShowChat);
    return () => window.removeEventListener('showChat', handleShowChat);
  }, []);

  // Mostrar loading mientras verifica auth
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navetec-primary"></div>
          <span className="text-gray-600">Verificando autenticación...</span>
        </div>
      </div>
    );
  }

  // Mostrar login si no está autenticado
  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Header 
        currentView={currentView} 
        onViewChange={setCurrentView}
        user={user}
        onLogout={handleLogout}
      />
      {currentView === 'dashboard' && user?.role === 'admin' ? (
        <Dashboard />
      ) : currentView === 'reports' ? (
        <Reports />
      ) : currentView === 'terrenos' ? (
        <TerrenosUpload />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <ContactsList 
            contacts={contacts}
            setContacts={setContacts}
            selectedContact={selectedContact}
            onSelectContact={setSelectedContact}
          />
          <ChatPanel 
            contact={selectedContact}
            onUpdateContact={(updatedContact) => {
              setSelectedContact(updatedContact);
              setContacts(prev => prev.map(c => 
                c.phone === updatedContact.phone ? updatedContact : c
              ));
            }}
          />
        </div>
      )}
    </div>
  );
}

export default App;