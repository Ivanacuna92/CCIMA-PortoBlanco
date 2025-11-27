const bcrypt = require('bcrypt');
const crypto = require('crypto');
const database = require('./database');

class AuthService {
    constructor() {
        this.saltRounds = 10;
        this.tokenExpireHours = 24; // Sesiones válidas por 24 horas
        // Caché de sesiones en memoria para evitar queries constantes
        this.sessionCache = new Map();
        this.cacheTTL = 60000; // 1 minuto de caché
    }

    // Limpiar entrada de caché
    clearSessionCache(token) {
        this.sessionCache.delete(token);
    }

    // Obtener sesión de caché si está válida
    getFromCache(token) {
        const cached = this.sessionCache.get(token);
        if (cached && Date.now() < cached.cacheExpires) {
            return cached.session;
        }
        // Si expiró el caché, eliminarlo
        if (cached) {
            this.sessionCache.delete(token);
        }
        return null;
    }

    // Guardar sesión en caché
    saveToCache(token, session) {
        this.sessionCache.set(token, {
            session,
            cacheExpires: Date.now() + this.cacheTTL
        });
    }

    // Verificar credenciales y crear sesión
    async login(email, password) {
        try {
            // Buscar usuario por email
            const user = await database.findOne(
                'support_users', 
                'email = ? AND active = 1', 
                [email]
            );

            if (!user) {
                throw new Error('Credenciales inválidas');
            }

            // Verificar contraseña
            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                throw new Error('Credenciales inválidas');
            }

            // Generar token de sesión
            const sessionToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + this.tokenExpireHours);

            // Guardar sesión en BD
            await database.insert('support_sessions', {
                user_id: user.id,
                session_token: sessionToken,
                expires_at: expiresAt
            });

            // Actualizar último login
            await database.update(
                'support_users',
                { last_login: new Date() },
                'id = ?',
                [user.id]
            );

            return {
                token: sessionToken,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role
                },
                expiresAt
            };
        } catch (error) {
            console.error('Error en login:', error);
            throw error;
        }
    }

    // Verificar si una sesión es válida
    async verifySession(token) {
        try {
            if (!token) {
                return null;
            }

            // Primero verificar caché
            const cachedSession = this.getFromCache(token);
            if (cachedSession) {
                return cachedSession;
            }

            // Buscar sesión válida en BD
            const session = await database.query(`
                SELECT s.*, u.id as user_id, u.email, u.name, u.role, u.active
                FROM support_sessions s
                JOIN support_users u ON s.user_id = u.id
                WHERE s.session_token = ?
                AND s.expires_at > NOW()
                AND u.active = 1
            `, [token]);

            if (!session || session.length === 0) {
                return null;
            }

            const sessionData = session[0];
            const result = {
                user: {
                    id: sessionData.user_id,
                    email: sessionData.email,
                    name: sessionData.name,
                    role: sessionData.role
                },
                expiresAt: sessionData.expires_at
            };

            // Guardar en caché para evitar queries frecuentes
            this.saveToCache(token, result);

            return result;
        } catch (error) {
            console.error('Error verificando sesión:', error);
            // En caso de error de BD, intentar usar caché aunque haya expirado
            const cached = this.sessionCache.get(token);
            if (cached) {
                console.log('Usando sesión de caché debido a error de BD');
                return cached.session;
            }
            return null;
        }
    }

    // Cerrar sesión
    async logout(token) {
        try {
            if (!token) {
                return;
            }

            // Limpiar caché
            this.clearSessionCache(token);

            await database.delete('support_sessions', 'session_token = ?', [token]);
        } catch (error) {
            console.error('Error en logout:', error);
        }
    }

    // Crear nuevo usuario (solo para admins)
    async createUser(email, password, name, role = 'support', createdByUserId) {
        try {
            // Verificar que quien crea es admin
            const creator = await database.findOne(
                'support_users',
                'id = ? AND role = ? AND active = 1',
                [createdByUserId, 'admin']
            );

            if (!creator) {
                throw new Error('No tienes permisos para crear usuarios');
            }

            // Verificar que el email no existe
            const existingUser = await database.findOne(
                'support_users',
                'email = ?',
                [email]
            );

            if (existingUser) {
                throw new Error('El email ya está registrado');
            }

            // Hash de la contraseña
            const passwordHash = await bcrypt.hash(password, this.saltRounds);

            // Crear usuario
            const userId = await database.insert('support_users', {
                email,
                password_hash: passwordHash,
                name,
                role,
                active: true
            });

            return {
                id: userId,
                email,
                name,
                role,
                active: true
            };
        } catch (error) {
            console.error('Error creando usuario:', error);
            throw error;
        }
    }

    // Cambiar contraseña
    async changePassword(userId, currentPassword, newPassword) {
        try {
            // Buscar usuario
            const user = await database.findOne(
                'support_users',
                'id = ? AND active = 1',
                [userId]
            );

            if (!user) {
                throw new Error('Usuario no encontrado');
            }

            // Verificar contraseña actual
            const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
            if (!isValidPassword) {
                throw new Error('Contraseña actual incorrecta');
            }

            // Hash de la nueva contraseña
            const newPasswordHash = await bcrypt.hash(newPassword, this.saltRounds);

            // Actualizar contraseña
            await database.update(
                'support_users',
                { password_hash: newPasswordHash },
                'id = ?',
                [userId]
            );

            return true;
        } catch (error) {
            console.error('Error cambiando contraseña:', error);
            throw error;
        }
    }

    // Limpiar sesiones expiradas
    async cleanupExpiredSessions() {
        try {
            await database.query('DELETE FROM support_sessions WHERE expires_at < NOW()');
        } catch (error) {
            console.error('Error limpiando sesiones expiradas:', error);
        }
    }

    // Obtener todos los usuarios (solo para admins)
    async getAllUsers(requestingUserId) {
        try {
            // Verificar que quien solicita es admin
            const requester = await database.findOne(
                'support_users',
                'id = ? AND role = ? AND active = 1',
                [requestingUserId, 'admin']
            );

            if (!requester) {
                throw new Error('No tienes permisos para ver usuarios');
            }

            const users = await database.findAll(
                'support_users',
                '1=1',
                [],
                'created_at DESC'
            );

            return users.map(user => ({
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                active: user.active,
                last_login: user.last_login,
                created_at: user.created_at
            }));
        } catch (error) {
            console.error('Error obteniendo usuarios:', error);
            throw error;
        }
    }
}

module.exports = new AuthService();