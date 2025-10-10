import { useState, useEffect } from 'react';
import { Upload, File, CheckCircle, XCircle, Trash2, Download } from 'lucide-react';
import * as api from '../services/api';

function TerrenosUpload() {
  const [uploading, setUploading] = useState(false);
  const [currentFile, setCurrentFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);

  useEffect(() => {
    fetchCurrentFile();
  }, []);

  const fetchCurrentFile = async () => {
    try {
      const response = await api.getUploadedCSVs();
      const files = response.files || [];
      // Como solo hay un archivo, tomar el primero
      setCurrentFile(files[0] || null);
    } catch (error) {
      console.error('Error fetching uploaded file:', error);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file) => {
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      setUploadStatus({ type: 'error', message: 'Por favor selecciona un archivo CSV' });
      return;
    }

    setUploading(true);
    setUploadStatus(null);

    const formData = new FormData();
    formData.append('csv', file);

    try {
      const response = await api.uploadCSV(formData);
      setUploadStatus({
        type: 'success',
        message: `Archivo cargado exitosamente. ${response.rowsProcessed} registros procesados. El archivo anterior fue reemplazado.`
      });
      fetchCurrentFile();
    } catch (error) {
      console.error('Error completo:', error);
      // Intentar obtener el mensaje de error del servidor
      let errorMessage = 'Error al cargar el archivo';

      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.message) {
        errorMessage = error.message;
      }

      setUploadStatus({
        type: 'error',
        message: errorMessage
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (filename) => {
    if (!confirm(`¿Estás seguro de eliminar ${filename}?`)) return;

    try {
      await api.deleteCSV(filename);
      setUploadStatus({
        type: 'success',
        message: `Archivo ${filename} eliminado exitosamente`
      });
      fetchCurrentFile();
    } catch (error) {
      setUploadStatus({
        type: 'error',
        message: 'Error al eliminar el archivo'
      });
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Gestión de Datos de Terrenos</h2>

      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive ? 'border-navetec-primary bg-blue-50' : 'border-gray-300'
        } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />

        <p className="text-lg mb-2">
          Arrastra y suelta tu archivo CSV aquí
        </p>
        <p className="text-sm text-gray-500 mb-4">
          o
        </p>

        <label className="inline-block">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileInput}
            className="hidden"
            disabled={uploading}
          />
          <span className="px-4 py-2 bg-navetec-primary text-white rounded hover:bg-navetec-dark cursor-pointer inline-block">
            Seleccionar archivo CSV
          </span>
        </label>

        <p className="text-xs text-gray-500 mt-4">
          Formato requerido: Nombre, Ubicación Estratégica, Precios, Metrajes, Plusvalia
        </p>

        <div className="mt-4">
          <a
            href="/api/csv/template"
            download="plantilla_terrenos.csv"
            className="inline-flex items-center px-3 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700"
          >
            <Download className="h-4 w-4 mr-2" />
            Descargar plantilla de ejemplo
          </a>
        </div>
      </div>

      {uploadStatus && (
        <div className={`mt-4 p-4 rounded ${
          uploadStatus.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}>
          <div className="flex items-start">
            {uploadStatus.type === 'success' ?
              <CheckCircle className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" /> :
              <XCircle className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" />
            }
            <div className="flex-1">
              <pre className="whitespace-pre-wrap font-sans text-sm">{uploadStatus.message}</pre>
            </div>
          </div>
        </div>
      )}

      {uploading && (
        <div className="mt-4 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navetec-primary"></div>
          <span className="ml-2">Procesando archivo...</span>
        </div>
      )}

      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-4">Archivo CSV Actual</h3>

        {!currentFile ? (
          <p className="text-gray-500">No hay archivo cargado aún</p>
        ) : (
          <div className="p-3 bg-gray-50 rounded">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <File className="h-5 w-5 text-gray-400 mr-2" />
                <div>
                  <p className="font-medium">{currentFile.name}</p>
                  <p className="text-sm text-gray-500">
                    {currentFile.records} registros • {new Date(currentFile.uploadDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDelete(currentFile.name)}
                className="text-red-500 hover:text-red-700"
                title="Eliminar archivo"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Nota: Subir un nuevo archivo reemplazará este automáticamente
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default TerrenosUpload;
