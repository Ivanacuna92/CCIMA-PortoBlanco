const mysql = require('mysql2/promise');
require('dotenv').config();

class Database {
    constructor() {
        this.pool = null;
        this.isConnected = false;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 segundo entre reintentos
    }

    async connect() {
        if (this.pool) {
            return this.pool;
        }

        try {
            this.pool = mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 3306,
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_NAME || 'whatspanel_db',
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0,
                enableKeepAlive: true,
                keepAliveInitialDelay: 10000, // Enviar keep-alive cada 10 segundos
                connectTimeout: 30000,
                // Importante: idleTimeout evita conexiones zombie
                idleTimeout: 60000
            });

            // Manejar errores del pool
            this.pool.on('error', (err) => {
                console.error('Error en pool de MySQL:', err);
                if (err.code === 'PROTOCOL_CONNECTION_LOST' ||
                    err.code === 'ECONNRESET' ||
                    err.code === 'ETIMEDOUT') {
                    console.log('Reconectando a MySQL...');
                    this.pool = null;
                    this.isConnected = false;
                }
            });

            // Verificar la conexión
            const connection = await this.pool.getConnection();
            await connection.ping();
            connection.release();

            this.isConnected = true;
            console.log('✅ Conectado a la base de datos MySQL');
            return this.pool;
        } catch (error) {
            console.error('❌ Error conectando a la base de datos:', error);
            this.pool = null;
            this.isConnected = false;
            throw error;
        }
    }

    // Helper para esperar entre reintentos
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Verificar si el error requiere reconexión
    isConnectionError(error) {
        const connectionErrors = [
            'PROTOCOL_CONNECTION_LOST',
            'ECONNRESET',
            'ETIMEDOUT',
            'ECONNREFUSED',
            'ER_CON_COUNT_ERROR',
            'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'
        ];
        return connectionErrors.includes(error.code) ||
               error.message?.includes('Connection lost') ||
               error.message?.includes('Cannot enqueue');
    }

    async query(sql, params = []) {
        let lastError;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                if (!this.pool || !this.isConnected) {
                    await this.connect();
                }
                const [results] = await this.pool.execute(sql, params);
                return results;
            } catch (error) {
                lastError = error;
                console.error(`Error en query (intento ${attempt}/${this.maxRetries}):`, error.message);

                // Si es error de conexión, intentar reconectar
                if (this.isConnectionError(error)) {
                    console.log('Detectado error de conexión, reconectando...');
                    this.pool = null;
                    this.isConnected = false;

                    if (attempt < this.maxRetries) {
                        await this.sleep(this.retryDelay * attempt);
                        continue;
                    }
                }

                // Si no es error de conexión o ya agotamos reintentos, lanzar
                if (attempt === this.maxRetries) {
                    throw error;
                }
            }
        }

        throw lastError;
    }

    async getConnection() {
        let lastError;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                if (!this.pool || !this.isConnected) {
                    await this.connect();
                }
                return await this.pool.getConnection();
            } catch (error) {
                lastError = error;
                console.error(`Error obteniendo conexión (intento ${attempt}/${this.maxRetries}):`, error.message);

                if (this.isConnectionError(error)) {
                    this.pool = null;
                    this.isConnected = false;

                    if (attempt < this.maxRetries) {
                        await this.sleep(this.retryDelay * attempt);
                        continue;
                    }
                }

                if (attempt === this.maxRetries) {
                    throw error;
                }
            }
        }

        throw lastError;
    }

    async transaction(callback) {
        const connection = await this.getConnection();
        try {
            await connection.beginTransaction();
            const result = await callback(connection);
            await connection.commit();
            return result;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.isConnected = false;
            console.log('Conexión a base de datos cerrada');
        }
    }

    // Métodos auxiliares para operaciones comunes
    async insert(table, data) {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = columns.map(() => '?').join(', ');
        
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
        const result = await this.query(sql, values);
        return result.insertId;
    }

    async update(table, data, where, whereParams = []) {
        const setClause = Object.keys(data).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(data), ...whereParams];
        
        const sql = `UPDATE ${table} SET ${setClause} WHERE ${where}`;
        return await this.query(sql, values);
    }

    async delete(table, where, params = []) {
        const sql = `DELETE FROM ${table} WHERE ${where}`;
        return await this.query(sql, params);
    }

    async findOne(table, where, params = []) {
        const sql = `SELECT * FROM ${table} WHERE ${where} LIMIT 1`;
        const results = await this.query(sql, params);
        return results[0] || null;
    }

    async findAll(table, where = '1=1', params = [], orderBy = '') {
        let sql = `SELECT * FROM ${table} WHERE ${where}`;
        if (orderBy) {
            sql += ` ORDER BY ${orderBy}`;
        }
        return await this.query(sql, params);
    }
}

// Singleton
const database = new Database();

module.exports = database;