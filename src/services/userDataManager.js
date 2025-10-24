const fs = require('fs').promises;
const path = require('path');

class UserDataManager {
    constructor() {
        this.dataFile = path.join(process.cwd(), 'data', 'user-data.json');
        this.cache = new Map();
        this.ensureDataDirectory();
        this.loadData();
    }

    async ensureDataDirectory() {
        const dataDir = path.dirname(this.dataFile);
        try {
            await fs.access(dataDir);
        } catch {
            await fs.mkdir(dataDir, { recursive: true });
        }
    }

    async loadData() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            const userData = JSON.parse(data);
            this.cache = new Map(Object.entries(userData));
        } catch (error) {
            // Si el archivo no existe, inicializar con datos vacíos
            this.cache = new Map();
            await this.saveData();
        }
    }

    async saveData() {
        try {
            const data = Object.fromEntries(this.cache);
            await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error guardando datos de usuario:', error);
        }
    }

    async getUserData(userId) {
        return this.cache.get(userId) || null;
    }

    async setUserData(userId, data) {
        const existingData = this.cache.get(userId) || {};

        const updatedData = {
            ...existingData,
            userId: userId,
            name: data.name !== undefined ? data.name : existingData.name,
            email: data.email !== undefined ? data.email : existingData.email,
            dataCollected: data.dataCollected !== undefined ? data.dataCollected : existingData.dataCollected,
            nameCollected: data.nameCollected !== undefined ? data.nameCollected : existingData.nameCollected,
            pendingSupportActivation: data.pendingSupportActivation !== undefined ? data.pendingSupportActivation : existingData.pendingSupportActivation,
            waitingForNameAfterInterest: data.waitingForNameAfterInterest !== undefined ? data.waitingForNameAfterInterest : existingData.waitingForNameAfterInterest,
            waitingForName: data.waitingForName !== undefined ? data.waitingForName : existingData.waitingForName,
            createdAt: existingData.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.cache.set(userId, updatedData);
        await this.saveData();
        return updatedData;
    }

    async isDataCollected(userId) {
        const userData = this.cache.get(userId);
        return userData && userData.dataCollected === true;
    }

    async markDataAsCollected(userId) {
        return await this.setUserData(userId, { dataCollected: true });
    }

    async getAllUsersData() {
        return Array.from(this.cache.values()).sort((a, b) =>
            new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
        );
    }

    async deleteUserData(userId) {
        this.cache.delete(userId);
        await this.saveData();
        return true;
    }

    // Validar formato de email
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Validar nombre (mínimo 2 caracteres, solo letras y espacios)
    isValidName(name) {
        const nameRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{2,50}$/;
        return nameRegex.test(name.trim());
    }

    // Obtener estado del proceso de recolección de datos
    getDataCollectionState(userId) {
        const userData = this.cache.get(userId);
        if (!userData) {
            return 'none'; // No hay datos
        }
        // Si está esperando nombre explícitamente
        if (userData.waitingForName) {
            return 'waiting_name';
        }
        // Si está esperando nombre después de mostrar interés
        if (userData.waitingForNameAfterInterest) {
            return 'waiting_name_after_interest';
        }
        // Si tiene flag de soporte pendiente y no tiene email
        if (userData.pendingSupportActivation && !userData.email) {
            return 'email_pending_for_support';
        }
        if (userData.dataCollected) {
            return 'completed'; // Datos completos
        }
        if (userData.nameCollected && !userData.email) {
            return 'name_collected'; // Solo tiene nombre
        }
        if (!userData.name) {
            return 'name_pending'; // Falta nombre
        }
        return 'validation_pending'; // Datos pendientes de validación
    }

    async markNameCollected(userId) {
        return await this.setUserData(userId, { nameCollected: true });
    }

    async setPendingSupportActivation(userId, value) {
        return await this.setUserData(userId, { pendingSupportActivation: value });
    }

    async hasPendingSupportActivation(userId) {
        const userData = this.cache.get(userId);
        return userData && userData.pendingSupportActivation === true;
    }

    async setWaitingForNameAfterInterest(userId, value) {
        return await this.setUserData(userId, { waitingForNameAfterInterest: value });
    }

    async setWaitingForName(userId, value) {
        return await this.setUserData(userId, { waitingForName: value });
    }

    // Detectar respuestas afirmativas comunes
    isAffirmativeResponse(message) {
        const affirmatives = [
            'si', 'sí', 'claro', 'por favor', 'adelante', 'de acuerdo', 'perfecto',
            'excelente', 'ok', 'okay', 'va', 'vale', 'dale', 'ándale', 'órale',
            'simón', 'sip', 'sale', 'jalo', 'venga', 'arre', 'porfa', 'obvio',
            'por supuesto', 'está bien', 'me parece', 'sí quiero', 'ya', 'ahora',
            'ahorita', 'de una vez', 'urgente', 'seguro', 'sep', 'seh', 'sipi',
            'oki', 'okey', 'see', 'simon'
        ];
        const normalized = message.toLowerCase().trim();
        return affirmatives.some(word => normalized === word || normalized.includes(word));
    }
}

module.exports = new UserDataManager();