const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parse/sync');

class CSVService {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data', 'terrenos');
    this.ensureDataDir();

    // Campos obligatorios que DEBE tener el CSV
    this.requiredFields = [
      'Nombre',
      'Ubicación Estratégica',
      'Precios',
      'Metrajes',
      'Plusvalia'
    ];
  }

  async ensureDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      console.error('Error creando directorio de datos:', error);
    }
  }

  async saveCSV(filename, content) {
    try {
      // Primero parsear para validar
      const records = csv.parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      // Validar que tenga registros
      if (records.length === 0) {
        throw new Error('El archivo CSV está vacío o no tiene datos válidos');
      }

      // Obtener los campos del CSV
      const csvFields = Object.keys(records[0]);

      // Validar que todos los campos requeridos estén presentes
      const missingFields = this.requiredFields.filter(field =>
        !csvFields.includes(field)
      );

      if (missingFields.length > 0) {
        throw new Error(`ERROR: Faltan los siguientes campos obligatorios en el CSV:\n${missingFields.join(', ')}\n\nEl archivo debe tener TODOS estos campos: ${this.requiredFields.join(', ')}`);
      }

      // Validar que no haya campos extras no esperados
      const extraFields = csvFields.filter(field =>
        !this.requiredFields.includes(field)
      );

      if (extraFields.length > 0) {
        throw new Error(`ERROR: El archivo contiene campos no permitidos:\n${extraFields.join(', ')}\n\nSolo se permiten estos campos: ${this.requiredFields.join(', ')}`);
      }

      // Validar que cada registro tenga datos válidos
      records.forEach((record, index) => {
        // Verificar que los campos obligatorios no estén vacíos
        this.requiredFields.forEach(field => {
          if (!record[field] || record[field].trim() === '') {
            throw new Error(`Fila ${index + 2}: El campo '${field}' no puede estar vacío`);
          }
        });
      });

      // ELIMINAR TODOS LOS ARCHIVOS CSV EXISTENTES
      const existingFiles = await fs.readdir(this.dataDir);
      for (const file of existingFiles) {
        if (file.endsWith('.csv')) {
          await fs.unlink(path.join(this.dataDir, file));
          console.log(`Archivo anterior eliminado: ${file}`);
        }
      }

      // Guardar el nuevo archivo con timestamp para evitar duplicados
      const timestamp = new Date().toISOString().split('T')[0];
      const newFilename = `terrenos_${timestamp}.csv`;
      const filePath = path.join(this.dataDir, newFilename);
      await fs.writeFile(filePath, content);

      return {
        success: true,
        filename: newFilename,
        rowsProcessed: records.length,
        records
      };
    } catch (error) {
      console.error('Error guardando CSV:', error);
      throw new Error(error.message);
    }
  }

  async getAllRecords() {
    try {
      const files = await this.listCSVFiles();
      let allRecords = [];

      for (const file of files) {
        const filePath = path.join(this.dataDir, file.name);
        const content = await fs.readFile(filePath, 'utf8');

        try {
          const records = csv.parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
          });

          allRecords = allRecords.concat(records);
        } catch (parseError) {
          console.error(`Error parseando archivo ${file.name}:`, parseError);
        }
      }

      return allRecords;
    } catch (error) {
      console.error('Error obteniendo todos los registros:', error);
      return [];
    }
  }

  async searchInCSV(query) {
    try {
      const records = await this.getAllRecords();

      // Normalizar la consulta
      const normalizedQuery = query.toLowerCase().trim();

      // Buscar en todos los campos
      const results = records.filter(record => {
        return Object.values(record).some(value => {
          if (value === null || value === undefined) return false;
          return String(value).toLowerCase().includes(normalizedQuery);
        });
      });

      return results;
    } catch (error) {
      console.error('Error buscando en CSV:', error);
      return [];
    }
  }

  async searchByField(fieldName, value) {
    try {
      const records = await this.getAllRecords();
      const normalizedValue = value.toLowerCase().trim();

      return records.filter(record => {
        const fieldValue = record[fieldName];
        if (!fieldValue) return false;
        return String(fieldValue).toLowerCase().includes(normalizedValue);
      });
    } catch (error) {
      console.error('Error buscando por campo:', error);
      return [];
    }
  }

  async listCSVFiles() {
    try {
      const files = await fs.readdir(this.dataDir);
      const csvFiles = files.filter(f => f.endsWith('.csv'));

      const fileDetails = await Promise.all(
        csvFiles.map(async (filename) => {
          const filePath = path.join(this.dataDir, filename);
          const stats = await fs.stat(filePath);

          // Contar registros
          let records = 0;
          try {
            const content = await fs.readFile(filePath, 'utf8');
            const parsed = csv.parse(content, {
              columns: true,
              skip_empty_lines: true
            });
            records = parsed.length;
          } catch (e) {
            console.error(`Error contando registros en ${filename}:`, e);
          }

          return {
            name: filename,
            uploadDate: stats.mtime,
            size: stats.size,
            records
          };
        })
      );

      return fileDetails.sort((a, b) => b.uploadDate - a.uploadDate);
    } catch (error) {
      console.error('Error listando archivos CSV:', error);
      return [];
    }
  }

  async deleteCSV(filename) {
    try {
      const filePath = path.join(this.dataDir, filename);
      await fs.unlink(filePath);
      return { success: true, message: `Archivo ${filename} eliminado` };
    } catch (error) {
      console.error('Error eliminando CSV:', error);
      throw new Error('Error eliminando archivo: ' + error.message);
    }
  }

  formatRecordForDisplay(record) {
    let formatted = [];

    if (record['Nombre']) {
      formatted.push(`*${record['Nombre']}*\n`);
    }

    if (record['Ubicación Estratégica']) {
      formatted.push(`*Ubicación Estratégica*\n${record['Ubicación Estratégica']}`);
    }

    if (record['Precios']) {
      formatted.push(`\n*Precios*\n${record['Precios']}`);
    }

    if (record['Metrajes']) {
      formatted.push(`\n*Metrajes*\n${record['Metrajes']}`);
    }

    if (record['Plusvalia']) {
      formatted.push(`\n*Plusvalía*\n${record['Plusvalia']}`);
    }

    return formatted.join('\n');
  }
}

module.exports = new CSVService();
