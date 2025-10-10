#!/usr/bin/env node

/**
 * Script interactivo para resetear la contraseña de un usuario
 *
 * Uso:
 *   node scripts/reset-password-interactive.js
 */

const bcrypt = require('bcrypt');
const readline = require('readline');
const database = require('../src/services/database');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function resetPassword() {
    try {
        console.log('🔧 Script interactivo de reseteo de contraseña\n');

        // Solicitar email
        const email = await question('📧 Ingresa el email del usuario: ');

        if (!email || email.trim() === '') {
            console.error('❌ Error: El email es requerido');
            rl.close();
            process.exit(1);
        }

        console.log('\n🔄 Buscando usuario...');

        // Buscar usuario por email
        const user = await database.findOne(
            'support_users',
            'email = ?',
            [email.trim()]
        );

        if (!user) {
            console.error(`❌ Error: No se encontró ningún usuario con el email "${email}"`);
            rl.close();
            process.exit(1);
        }

        console.log(`\n✅ Usuario encontrado:`);
        console.log(`   Nombre: ${user.name}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Rol: ${user.role}`);
        console.log(`   Estado: ${user.active ? 'Activo' : 'Inactivo'}`);
        console.log(`   Último login: ${user.last_login || 'Nunca'}`);

        // Confirmar acción
        const confirm = await question('\n⚠️  ¿Deseas continuar con el reseteo de contraseña? (s/n): ');

        if (confirm.toLowerCase() !== 's' && confirm.toLowerCase() !== 'si') {
            console.log('❌ Operación cancelada');
            rl.close();
            process.exit(0);
        }

        // Solicitar nueva contraseña
        const newPassword = await question('\n🔐 Ingresa la nueva contraseña (mínimo 8 caracteres): ');

        if (!newPassword || newPassword.length < 8) {
            console.error('❌ Error: La contraseña debe tener al menos 8 caracteres');
            rl.close();
            process.exit(1);
        }

        // Confirmar contraseña
        const confirmPassword = await question('🔐 Confirma la nueva contraseña: ');

        if (newPassword !== confirmPassword) {
            console.error('❌ Error: Las contraseñas no coinciden');
            rl.close();
            process.exit(1);
        }

        console.log('\n🔄 Actualizando contraseña...');

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
        console.log('🔒 Todas las sesiones anteriores han sido cerradas\n');

        rl.close();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error al resetear la contraseña:', error.message);
        console.error(error);
        rl.close();
        process.exit(1);
    }
}

// Ejecutar el script
resetPassword();
