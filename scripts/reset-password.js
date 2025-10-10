#!/usr/bin/env node

/**
 * Script para resetear la contraseña de un usuario por su email
 *
 * Uso:
 *   node scripts/reset-password.js <email> <nueva-contraseña>
 *
 * Ejemplo:
 *   node scripts/reset-password.js admin@navetec.com MiNuevaContraseña123
 */

const bcrypt = require('bcrypt');
const database = require('../src/services/database');

async function resetPassword(email, newPassword) {
    try {
        console.log('🔄 Conectando a la base de datos...');

        // Buscar usuario por email
        const user = await database.findOne(
            'support_users',
            'email = ?',
            [email]
        );

        if (!user) {
            console.error(`❌ Error: No se encontró ningún usuario con el email "${email}"`);
            process.exit(1);
        }

        console.log(`✅ Usuario encontrado: ${user.name} (${user.email})`);
        console.log(`   Rol: ${user.role}`);
        console.log(`   Estado: ${user.active ? 'Activo' : 'Inactivo'}`);

        // Validar contraseña
        if (!newPassword || newPassword.length < 8) {
            console.error('❌ Error: La contraseña debe tener al menos 8 caracteres');
            process.exit(1);
        }

        console.log('\n🔐 Generando hash de la nueva contraseña...');

        // Hash de la nueva contraseña
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);

        // Actualizar contraseña en la base de datos
        await database.update(
            'support_users',
            {
                password_hash: passwordHash,
                updated_at: new Date()
            },
            'id = ?',
            [user.id]
        );

        console.log('✅ Contraseña actualizada correctamente');
        console.log('\n📋 Nuevas credenciales:');
        console.log(`   Email: ${user.email}`);
        console.log(`   Contraseña: ${newPassword}`);
        console.log('\n⚠️  Guarda esta contraseña en un lugar seguro');

        // Invalidar todas las sesiones del usuario
        await database.delete('support_sessions', 'user_id = ?', [user.id]);
        console.log('🔒 Todas las sesiones anteriores han sido cerradas');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error al resetear la contraseña:', error.message);
        console.error(error);
        process.exit(1);
    }
}

// Validar argumentos de línea de comandos
const args = process.argv.slice(2);

if (args.length < 2) {
    console.log('❌ Error: Faltan argumentos\n');
    console.log('Uso:');
    console.log('  node scripts/reset-password.js <email> <nueva-contraseña>\n');
    console.log('Ejemplo:');
    console.log('  node scripts/reset-password.js admin@navetec.com MiNuevaContraseña123\n');
    process.exit(1);
}

const [email, newPassword] = args;

// Ejecutar el script
console.log('🔧 Script de reseteo de contraseña\n');
resetPassword(email, newPassword);
