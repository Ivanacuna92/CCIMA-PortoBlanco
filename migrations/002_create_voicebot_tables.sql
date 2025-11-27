-- ============================================================
-- VOICEBOT TABLES
-- Sistema de llamadas automatizadas con IA
-- ============================================================

-- Tabla de campanas
CREATE TABLE IF NOT EXISTS voicebot_campaigns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_name VARCHAR(255) NOT NULL,
    csv_filename VARCHAR(255),
    total_contacts INT DEFAULT 0,
    calls_completed INT DEFAULT 0,
    calls_pending INT DEFAULT 0,
    calls_failed INT DEFAULT 0,
    appointments_scheduled INT DEFAULT 0,
    status ENUM('pending', 'running', 'paused', 'completed', 'cancelled') DEFAULT 'pending',
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de contactos
CREATE TABLE IF NOT EXISTS voicebot_contacts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    client_name VARCHAR(255),
    property_type VARCHAR(100),
    property_location VARCHAR(255),
    property_size VARCHAR(50),
    property_price VARCHAR(100),
    extra_info TEXT,
    call_status ENUM('pending', 'calling', 'in_call', 'completed', 'failed', 'no_answer', 'busy', 'invalid') DEFAULT 'pending',
    call_attempts INT DEFAULT 0,
    last_attempt_at TIMESTAMP NULL,
    interest_level ENUM('high', 'medium', 'low') DEFAULT 'medium',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES voicebot_campaigns(id) ON DELETE CASCADE,
    INDEX idx_campaign_status (campaign_id, call_status),
    INDEX idx_phone (phone_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de llamadas
CREATE TABLE IF NOT EXISTS voicebot_calls (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contact_id INT,
    campaign_id INT,
    phone_number VARCHAR(20) NOT NULL,
    call_start TIMESTAMP NULL,
    call_end TIMESTAMP NULL,
    duration_seconds INT DEFAULT 0,
    call_status ENUM('ringing', 'answered', 'in_progress', 'completed', 'failed', 'no_answer', 'busy') DEFAULT 'ringing',
    asterisk_channel VARCHAR(100),
    asterisk_uniqueid VARCHAR(100),
    audio_recording_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_id) REFERENCES voicebot_contacts(id) ON DELETE SET NULL,
    FOREIGN KEY (campaign_id) REFERENCES voicebot_campaigns(id) ON DELETE SET NULL,
    INDEX idx_campaign (campaign_id),
    INDEX idx_contact (contact_id),
    INDEX idx_call_start (call_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de transcripciones
CREATE TABLE IF NOT EXISTS voicebot_transcriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    call_id INT NOT NULL,
    sequence_number INT DEFAULT 0,
    speaker ENUM('bot', 'client', 'unknown') DEFAULT 'unknown',
    audio_chunk_path VARCHAR(500),
    transcription TEXT,
    response_text TEXT,
    confidence_score DECIMAL(5,4) DEFAULT 0,
    processing_time_ms INT DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (call_id) REFERENCES voicebot_calls(id) ON DELETE CASCADE,
    INDEX idx_call_sequence (call_id, sequence_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de citas agendadas
CREATE TABLE IF NOT EXISTS voicebot_appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    call_id INT,
    contact_id INT,
    campaign_id INT,
    phone_number VARCHAR(20),
    client_name VARCHAR(255),
    appointment_date DATE,
    appointment_time VARCHAR(20),
    appointment_notes TEXT,
    interest_level ENUM('high', 'medium', 'low') DEFAULT 'medium',
    agreement_reached BOOLEAN DEFAULT FALSE,
    status ENUM('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show') DEFAULT 'scheduled',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (call_id) REFERENCES voicebot_calls(id) ON DELETE SET NULL,
    FOREIGN KEY (contact_id) REFERENCES voicebot_contacts(id) ON DELETE SET NULL,
    FOREIGN KEY (campaign_id) REFERENCES voicebot_campaigns(id) ON DELETE SET NULL,
    INDEX idx_date (appointment_date),
    INDEX idx_status (status),
    INDEX idx_campaign (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DATOS INICIALES (Opcional - para testing)
-- ============================================================

-- Puedes descomentar las siguientes lineas para insertar datos de prueba

-- INSERT INTO voicebot_campaigns (campaign_name, csv_filename, total_contacts, created_by)
-- VALUES ('Campana Demo', 'demo.csv', 0, 'Sistema');
