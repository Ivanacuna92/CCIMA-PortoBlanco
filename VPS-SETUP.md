# Configuración del VPS para WhatsApp Bot con Baileys

## Error 515 (Stream Errored)

Este error es común al desplegar en VPS y generalmente se debe a problemas de red, timeouts o recursos limitados.

## Requisitos Mínimos del VPS

### Hardware
- **RAM**: Mínimo 1GB (recomendado 2GB)
- **CPU**: 1 core (recomendado 2 cores)
- **Disco**: 10GB disponibles
- **Ancho de banda**: Conexión estable con buen uptime

### Software
- **Node.js**: v18 o superior
- **npm**: v9 o superior
- **Sistema Operativo**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+

## Configuración del VPS

### 1. Verificar Recursos Disponibles

```bash
# Verificar memoria
free -h

# Verificar CPU
lscpu
top

# Verificar espacio en disco
df -h
```

### 2. Configurar Firewall

Asegúrate de que el firewall permite conexiones WebSocket:

```bash
# Ubuntu/Debian con UFW
sudo ufw allow 3001/tcp  # Puerto del web server
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 80/tcp    # HTTP

# Para CentOS/RHEL con firewalld
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --reload
```

### 3. Optimizar Límites del Sistema

Edita `/etc/security/limits.conf`:

```bash
* soft nofile 65535
* hard nofile 65535
```

### 4. Variables de Entorno

Crea o actualiza tu archivo `.env`:

```env
DEEPSEEK_API_KEY=tu_api_key_aqui
WEB_PORT=3001
NODE_ENV=production

# Opcional: Para debugging
DEBUG=baileys*
```

### 5. Usar un Process Manager

Se recomienda usar PM2 para gestionar el proceso:

```bash
# Instalar PM2
npm install -g pm2

# Iniciar el bot
pm2 start npm --name "whatsapp-bot" -- start

# Ver logs en tiempo real
pm2 logs whatsapp-bot

# Reiniciar si es necesario
pm2 restart whatsapp-bot

# Configurar auto-inicio
pm2 startup
pm2 save
```

## Solución de Problemas Comunes

### Error 515 persiste después de configuración

1. **Verificar conexión de red**:
   ```bash
   # Probar conectividad a WhatsApp
   ping web.whatsapp.com
   curl -I https://web.whatsapp.com
   ```

2. **Revisar logs del sistema**:
   ```bash
   # Si usas PM2
   pm2 logs whatsapp-bot --lines 100

   # Si corres directamente
   tail -f logs/*.log
   ```

3. **Limpiar sesión y reiniciar**:
   ```bash
   # Detener el bot
   pm2 stop whatsapp-bot

   # Eliminar sesión actual
   rm -rf auth_baileys

   # Reiniciar
   pm2 restart whatsapp-bot
   ```

4. **Verificar uso de recursos durante la ejecución**:
   ```bash
   # Mientras el bot está corriendo
   pm2 monit
   # o
   htop
   ```

### El QR no se genera

1. Verifica que el puerto 3001 esté abierto y accesible
2. Revisa los logs: `pm2 logs whatsapp-bot`
3. Asegúrate de que no hay otra instancia corriendo: `pm2 list`

### Conexión se cierra después de escanear QR

1. **Puede ser problema de memoria**: Aumenta la memoria del VPS o usa swap
2. **Verifica logs de WhatsApp**: Revisa si hay mensajes de "rate limit" o "spam"
3. **Espera más tiempo**: A veces la primera conexión toma 2-3 minutos

## Mejoras Implementadas en el Código

### Timeouts Ajustados para VPS
- `connectTimeoutMs`: 120000 (2 minutos) - antes 60000
- `keepAliveIntervalMs`: 45000 (45 segundos) - antes 30000
- `qrTimeout`: 60000 (1 minuto) - nuevo
- `retryRequestDelayMs`: 500ms - antes 250ms
- `maxMsgRetryCount`: 3 - antes 5

### Manejo Específico del Error 515
- Detecta automáticamente el error 515
- Implementa delays progresivos: 10s, 15s, 20s
- Máximo 3 intentos de reconexión antes de pedir intervención manual
- Muestra diagnóstico de posibles causas

### Logs Mejorados
- Muestra código de error y mensaje detallado
- Indica el intento de reconexión actual
- Sugiere acciones cuando se alcanza el máximo de intentos

## Recomendaciones Adicionales

### 1. Usar Reverse Proxy (nginx)

Configurar nginx para servir el panel web:

```nginx
server {
    listen 80;
    server_name tu-dominio.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 2. Configurar SSL con Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.com
```

### 3. Monitoreo del Bot

Crea un script de monitoreo simple:

```bash
#!/bin/bash
# monitor.sh
while true; do
    if ! pm2 list | grep -q "whatsapp-bot.*online"; then
        echo "$(date): Bot caído, reiniciando..."
        pm2 restart whatsapp-bot
    fi
    sleep 60
done
```

### 4. Backups Automáticos

```bash
# Agregar a crontab
0 2 * * * tar -czf ~/backups/auth_baileys_$(date +\%Y\%m\%d).tar.gz ~/tu-proyecto/auth_baileys
```

## Proveedores de VPS Recomendados

- **DigitalOcean**: Buen balance precio/rendimiento
- **Vultr**: Buena conectividad global
- **Linode**: Estable y confiable
- **Hetzner**: Económico con buenos recursos

**Nota**: Evita VPS muy económicos (<$3/mes) ya que suelen tener recursos muy limitados y conectividad inestable.

## Contacto y Soporte

Si después de seguir estos pasos el error persiste:

1. Verifica los logs completos: `pm2 logs whatsapp-bot --lines 200`
2. Revisa el uso de recursos: `pm2 monit`
3. Contacta al proveedor del VPS para verificar que no haya restricciones de red
4. Considera cambiar a un VPS con mejores especificaciones
