const database = require('./src/services/database');

async function checkFollowUpCounts() {
    try {
        await database.connect();

        console.log('=== DIAGNÓSTICO DE FOLLOW_UP_COUNT ===\n');

        // 1. Verificar todos los registros
        const allFollowUps = await database.query('SELECT * FROM follow_ups ORDER BY last_follow_up DESC');

        console.log(`Total de registros: ${allFollowUps.length}\n`);

        console.log('Estado actual de la base de datos:');
        console.log('─'.repeat(120));
        console.log(
            'USER_ID'.padEnd(20) +
            'COUNT'.padEnd(8) +
            'STATUS'.padEnd(12) +
            'LAST_FOLLOW_UP'.padEnd(25) +
            'HOURS_SINCE'.padEnd(15) +
            'STARTED_AT'
        );
        console.log('─'.repeat(120));

        for (const row of allFollowUps) {
            const now = new Date();
            const lastFollowUp = new Date(row.last_follow_up);
            const hoursSince = Math.floor((now - lastFollowUp) / (1000 * 60 * 60));

            console.log(
                row.user_id.padEnd(20) +
                String(row.follow_up_count).padEnd(8) +
                row.status.padEnd(12) +
                lastFollowUp.toLocaleString('es-MX').padEnd(25) +
                `${hoursSince}h`.padEnd(15) +
                new Date(row.started_at).toLocaleString('es-MX')
            );
        }

        console.log('\n=== ANÁLISIS ===\n');

        // 2. Contar por estado
        const activeCount = allFollowUps.filter(f => f.status === 'active').length;
        const stoppedCount = allFollowUps.filter(f => f.status === 'stopped').length;

        console.log(`✓ Seguimientos activos: ${activeCount}`);
        console.log(`✓ Seguimientos detenidos: ${stoppedCount}`);

        // 3. Verificar registros con count = 0
        const zeroCount = allFollowUps.filter(f => f.follow_up_count === 0);
        console.log(`\n⚠️  Registros con follow_up_count = 0: ${zeroCount.length}`);

        // 4. Verificar registros que deberían haber recibido seguimiento (>24h y count=0)
        const shouldHaveFollowUp = allFollowUps.filter(f => {
            const hoursSince = Math.floor((new Date() - new Date(f.last_follow_up)) / (1000 * 60 * 60));
            return f.status === 'active' && hoursSince >= 24 && f.follow_up_count === 0;
        });

        console.log(`⚠️  Registros activos >24h sin seguimiento enviado: ${shouldHaveFollowUp.length}`);

        if (shouldHaveFollowUp.length > 0) {
            console.log('\nDetalles:');
            shouldHaveFollowUp.forEach(f => {
                const hoursSince = Math.floor((new Date() - new Date(f.last_follow_up)) / (1000 * 60 * 60));
                console.log(`  - ${f.user_id}: ${hoursSince}h desde último seguimiento`);
            });
        }

        // 5. Test de actualización
        console.log('\n=== TEST DE ACTUALIZACIÓN ===\n');

        if (allFollowUps.length > 0) {
            const testRow = allFollowUps[0];
            console.log(`Probando actualización en registro: ${testRow.user_id}`);
            console.log(`  Valor actual: ${testRow.follow_up_count}`);

            const newValue = testRow.follow_up_count + 1;

            // Intentar actualización
            const result = await database.update(
                'follow_ups',
                { follow_up_count: newValue },
                'user_id = ?',
                [testRow.user_id]
            );

            console.log(`  Filas afectadas: ${result.affectedRows || result.changedRows || 'N/A'}`);

            // Verificar actualización
            const updated = await database.findOne('follow_ups', 'user_id = ?', [testRow.user_id]);
            console.log(`  Nuevo valor: ${updated.follow_up_count}`);

            if (updated.follow_up_count === newValue) {
                console.log('  ✅ Actualización EXITOSA');

                // Revertir cambio
                await database.update(
                    'follow_ups',
                    { follow_up_count: testRow.follow_up_count },
                    'user_id = ?',
                    [testRow.user_id]
                );
                console.log('  ✅ Cambio revertido');
            } else {
                console.log('  ❌ Actualización FALLÓ');
            }
        }

        await database.close();

    } catch (error) {
        console.error('Error:', error);
        await database.close();
    }
}

checkFollowUpCounts();
