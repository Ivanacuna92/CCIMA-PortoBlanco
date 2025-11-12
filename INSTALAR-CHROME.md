# Instalar Chrome en VPS

El bot ahora puede usar **Chrome instalado en tu sistema** en lugar de descargar Chromium con Puppeteer. Esto puede mejorar la compatibilidad y reducir el uso de espacio.

## ✅ Detección Automática

El bot detecta automáticamente Chrome en:
- **Linux**: `/usr/bin/google-chrome`, `/usr/bin/chromium-browser`, etc.
- **macOS**: `/Applications/Google Chrome.app/...`
- **Windows**: `C:\Program Files\Google\Chrome\...`

Si no encuentra Chrome, usa Chromium de Puppeteer automáticamente.

---

## 🐧 Instalar Chrome en Linux (VPS)

### Ubuntu/Debian

```bash
# 1. Actualizar repositorios
sudo apt update

# 2. Instalar dependencias necesarias
sudo apt install -y wget gnupg

# 3. Agregar repositorio de Google Chrome
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list'

# 4. Instalar Google Chrome
sudo apt update
sudo apt install -y google-chrome-stable

# 5. Verificar instalación
google-chrome --version
```

### Alternativa: Chromium (más ligero)

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y chromium-browser

# Verificar
chromium-browser --version
```

### CentOS/RHEL/Fedora

```bash
# 1. Agregar repositorio
sudo cat <<EOF > /etc/yum.repos.d/google-chrome.repo
[google-chrome]
name=google-chrome
baseurl=http://dl.google.com/linux/chrome/rpm/stable/x86_64
enabled=1
gpgcheck=1
gpgkey=https://dl.google.com/linux/linux_signing_key.pub
EOF

# 2. Instalar Chrome
sudo yum install -y google-chrome-stable

# O con dnf (Fedora)
sudo dnf install -y google-chrome-stable

# 3. Verificar
google-chrome --version
```

---

## 🍎 macOS

```bash
# Con Homebrew
brew install --cask google-chrome

# O descargar manualmente de:
# https://www.google.com/chrome/
```

---

## 🪟 Windows

Descarga Chrome desde: https://www.google.com/chrome/

---

## ⚙️ Configuración Manual (Opcional)

Si Chrome está en una ubicación no estándar, especifícala en `.env`:

```env
DEEPSEEK_API_KEY=tu_api_key
WEB_PORT=3001

# Especificar ruta de Chrome manualmente
CHROME_PATH=/ruta/custom/chrome
```

**Ejemplos**:
```env
# Linux con Chrome en snap
CHROME_PATH=/snap/bin/chromium

# macOS con Chromium
CHROME_PATH=/Applications/Chromium.app/Contents/MacOS/Chromium

# Windows
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

---

## 🔍 Verificar que Funciona

Cuando inicies el bot, verás uno de estos mensajes:

```bash
✅ Chrome encontrado en: /usr/bin/google-chrome
🌐 Usando Chrome del sistema
```

O si no encuentra Chrome:

```bash
⚠️  Chrome no encontrado, usando Chromium de Puppeteer
🌐 Usando Chromium de Puppeteer
```

---

## 🐛 Solución de Problemas

### Error: "Chrome no arranca"

Instala dependencias faltantes:

```bash
# Ubuntu/Debian
sudo apt install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2

# CentOS/RHEL
sudo yum install -y \
    nss \
    atk \
    cups-libs \
    libdrm \
    libXrandr \
    libXcomposite \
    libXdamage \
    alsa-lib
```

### Error: "Chrome no se encuentra"

Verifica la ruta manualmente:

```bash
# Linux
which google-chrome
which chromium-browser

# macOS
ls /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
```

Luego agrega la ruta correcta a `.env` con `CHROME_PATH=...`

### Chrome consume mucha RAM

Si tu VPS tiene poca RAM (<2GB), considera:

1. **Usar Chromium en lugar de Chrome** (más ligero)
2. **Agregar swap** si no tienes:
   ```bash
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

3. **O dejar que use Chromium de Puppeteer** (el bot funciona igual)

---

## 💡 Ventajas de Usar Chrome del Sistema

✅ **Menos espacio**: No descarga Chromium extra (~150MB)
✅ **Más estable**: Chrome actualizado por el sistema
✅ **Mejor rendimiento**: Optimizado para tu OS
✅ **Más rápido**: No necesita descargar Chromium al iniciar

---

## 🚀 Probar

```bash
# Local
npm run dev

# VPS con PM2
pm2 restart whatsapp-bot
pm2 logs whatsapp-bot
```

Deberías ver en los logs si está usando Chrome del sistema o Chromium de Puppeteer.
