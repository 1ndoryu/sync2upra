//sync.js
const {ipcMain} = require('electron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const API_BASE = 'https://2upra.com/wp-json';
const {appWindow} = require('../main.js');

let Store;
let store;

(async () => {
    try {
        Store = (await import('electron-store')).default;
        store = new Store();
        let userId = store.get('userId')?.userId || null;
        const downloadDir = store.get('downloadDir');
        if (userId && downloadDir) {
            startSyncing(userId, downloadDir);
        }
    } catch (error) {
        console.error('Error al importar electron-store:', error);
    }
})();

let lastSyncTimestamp = 0;
let syncInterval;
const DOWNLOAD_INTERVAL_MS = 30000;

const downloadFile = async (url, filePath) => {
    const response = await axios({
        method: 'get',
        url,
        responseType: 'stream',
        headers: {'X-Electron-App': 'true'}
    });
    return new Promise((resolve, reject) => {
        response.data.pipe(fs.createWriteStream(filePath)).on('finish', resolve).on('error', reject);
    });
};

/*
parece que no verifica las imagenes ya fueron descargadas e intenta descargarla varias veces
las borra y despues las vuelve a descargar

Evento registrado: delete - {
  filePath: 'C:\\Users\\1u\\Documents\\Audios3\\.hidden_images\\Pinterest_Download-32-11.jpg'
}
Imagen descargada y almacenada en: C:\Users\1u\Documents\Audios3\.hidden_images\pincase202411036949.jpeg
Evento registrado: image-download - {
  userId: '355',
  imagePath: 'C:\\Users\\1u\\Documents\\Audios3\\.hidden_images\\pincase202411036949.jpeg'
}
*/

const syncSingleAudio = async (userId, postId, downloadDir) => {
    const url = `${API_BASE}/1/v1/syncpre/${userId}?post_id=${postId}`;
    try {
        const response = await axios.get(url, {
            headers: { 'X-Electron-App': 'true' },
            withCredentials: true
        });

        const audioToDownload = response.data[0];
        if (!audioToDownload || !audioToDownload.download_url) return;

        // Manejo del directorio de audios
        const collectionDir = path.join(downloadDir, audioToDownload.collection);
        if (!fs.existsSync(collectionDir)) {
            fs.mkdirSync(collectionDir, { recursive: true });
        }
        const audioFilePath = path.join(collectionDir, audioToDownload.audio_filename);

        // Descargar el audio
        await downloadFile(audioToDownload.download_url, audioFilePath);
        logSyncEvent('download', { userId, filePath: audioFilePath });

        // Manejo del directorio temporal para imágenes
        const tempImageDir = path.join(downloadDir, '.hidden_images');
        if (audioToDownload.image) {
            const imagePath = await handleImageDownload(audioToDownload.image, tempImageDir);
            logSyncEvent('image-download', { userId, imagePath });
        }

        ipcMain.emit('sync-file-downloaded', audioFilePath);
    } catch (error) {
        console.error('Error al sincronizar audio individual:', error);
    }
};
//sync.js

const syncAudios = async (userId, downloadDir) => {
    const url = `${API_BASE}/1/v1/syncpre/${userId}`;
    try {
        const response = await axios.get(url, {
            headers: { 'X-Electron-App': 'true' },
            withCredentials: true
        });

        const audiosToDownload = response.data;
        if (!audiosToDownload || audiosToDownload.length === 0) {
            cleanDownloadDir(downloadDir);
        } else {
            prepareDownloadDir(downloadDir, audiosToDownload);

            const tempImageDir = path.join(downloadDir, '.hidden_images'); // Carpeta para imágenes
            for (const audio of audiosToDownload) {
                if (audio.download_url) {
                    // Descargar audio
                    await handleFileDownload(audio, downloadDir, userId);
                }

                if (audio.image) {
                    // Descargar imagen asociada
                    const imagePath = await handleImageDownload(audio.image, tempImageDir);
                    logSyncEvent('image-download', { userId, imagePath });
                }
            }

            lastSyncTimestamp = Math.floor(Date.now() / 1000);
            store?.set('lastSyncTimestamp', lastSyncTimestamp);
        }

        ipcMain.emit('sync-completed');
    } catch (error) {
        console.error('Error al sincronizar audios:', error);
        ipcMain.emit('sync-error', error);
    }
};

const handleFileDownload = async (audio, downloadDir, userId) => {
    const collectionDir = path.join(downloadDir, audio.collection);
    if (!fs.existsSync(collectionDir)) {
        fs.mkdirSync(collectionDir, {recursive: true});
    }
    const filePath = path.join(collectionDir, audio.audio_filename);

    if (!fs.existsSync(filePath)) {
        await downloadFile(audio.download_url, filePath);
        logSyncEvent('download', {userId, filePath});
        console.log('enviando sync-completed');
        ipcMain.emit('sync-file-downloaded', filePath);
    }
};

const handleImageDownload = async (imageUrl, tempDir) => {
    try {
        // Crear el directorio si no existe
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Generar un nombre de archivo único basado en la URL
        const fileName = path.basename(new URL(imageUrl).pathname);
        const filePath = path.join(tempDir, fileName);

        // Verificar si ya existe la imagen
        if (fs.existsSync(filePath)) {
            console.log(`Imagen ya existe, se omite la descarga: ${filePath}`);
            return filePath; // Retornar la ruta existente
        }

        // Descargar la imagen si no existe
        console.log(`Descargando imagen desde: ${imageUrl}`);
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

        // Guardar la imagen en el archivo
        fs.writeFileSync(filePath, Buffer.from(response.data));
        console.log(`Imagen descargada y almacenada en: ${filePath}`);
        
        return filePath; // Retornar la ruta del archivo descargado
    } catch (error) {
        console.error('Error al descargar o manejar la imagen:', error);
        throw error;
    }
};
const prepareDownloadDir = (downloadDir, audiosToDownload) => {
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }

    const remoteFilePaths = new Set(
        audiosToDownload.map((audio) => {
            const collectionDir = path.join(downloadDir, audio.collection);
            return path.join(collectionDir, audio.audio_filename);
        })
    );

    const tempImageDir = path.join(downloadDir, '.hidden_images');
    const remoteImagePaths = new Set(
        audiosToDownload
            .filter((audio) => audio.image) // Filtrar solo audios con imágenes
            .map((audio) => {
                const fileName = path.basename(new URL(audio.image).pathname);
                return path.join(tempImageDir, fileName); // Generar la ruta correcta
            })
    );

    cleanLocalFiles(downloadDir, remoteFilePaths);
    cleanImageDir(tempImageDir, remoteImagePaths); // Pasar la lista completa de imágenes remotas
};

const cleanLocalFiles = (downloadDir, remoteFilePaths) => {
    const localFiles = [];
    const recursivelyFindFiles = dir => {
        const items = fs.readdirSync(dir);
        items.forEach(item => {
            const fullPath = path.join(dir, item);
            if (fs.statSync(fullPath).isDirectory()) {
                recursivelyFindFiles(fullPath);
            } else {
                // Skip sync-history.json
                if (item !== 'sync-history.json') {
                    localFiles.push(fullPath);
                }
            }
        });
    };

    recursivelyFindFiles(downloadDir);

    for (const localFile of localFiles) {
        if (!remoteFilePaths.has(localFile)) {
            fs.unlinkSync(localFile);
            logSyncEvent('delete', {filePath: localFile});
        }
    }
};

const cleanDownloadDir = downloadDir => {
    if (fs.existsSync(downloadDir)) {
        fs.rmSync(downloadDir, { recursive: true, force: true });
        logSyncEvent('delete-all', { downloadDir });

        // Eliminar imágenes
        const tempImageDir = path.join(downloadDir, '.hidden_images');
        cleanImageDir(tempImageDir);
    }
};
const cleanImageDir = (tempImageDir, remoteImagePaths) => {
    if (!fs.existsSync(tempImageDir)) return;

    const localImages = fs.readdirSync(tempImageDir).map((file) =>
        path.join(tempImageDir, file)
    );

    for (const localImage of localImages) {
        // Solo eliminar imágenes que no están en la lista de imágenes remotas
        if (!remoteImagePaths || !remoteImagePaths.has(localImage)) {
            fs.unlinkSync(localImage); // Eliminar imágenes no referenciadas
            logSyncEvent('delete-image', { filePath: localImage });
        }
    }
};
const logSyncEvent = (eventType, details) => {
    const historyFile = path.join(store.get('downloadDir'), 'sync-history.json');
    const timestamp = new Date().toISOString();
    const event = {timestamp, eventType, details};
    let history = [];

    if (fs.existsSync(historyFile)) {
        try {
            history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        } catch (error) {
            console.error('Error al leer el historial de sincronización:', error);
        }
    }

    history.push(event);

    try {
        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');
        console.log(`Evento registrado: ${eventType} -`, details);
    } catch (error) {
        console.error('Error al guardar el historial de sincronización:', error);
    }

    // Notificar a la UI
    ipcMain.emit('sync-history-updated', history);
};

const startSyncing = (userId, downloadDir) => {
    if (syncInterval) clearInterval(syncInterval);

    syncInterval = setInterval(() => checkForChangesAndSync(userId, downloadDir), DOWNLOAD_INTERVAL_MS);
    checkForChangesAndSync(userId, downloadDir);

    store.set('userId', userId);
    store.set('downloadDir', downloadDir);
};

const checkForChangesAndSync = async (userId, downloadDir) => {
    lastSyncTimestamp = store?.get('lastSyncTimestamp') || 0;
    const checkUrl = `${API_BASE}/1/v1/syncpre/${userId}/check?last_sync=${lastSyncTimestamp}`;

    try {
        const response = await axios.get(checkUrl, {
            headers: {'X-Electron-App': 'true'},
            withCredentials: true
        });

        if (response.data?.descargas_modificado || response.data?.samplesGuardados_modificado) {
            await syncAudios(userId, downloadDir);
        }
    } catch (error) {
        console.error('Error al verificar cambios:', error);
    }
};

module.exports = {
    startSyncing,
    stopSyncing: () => {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
    },
    syncSingleAudio,
    getSyncHistory: () => {
        const downloadDir = store.get('downloadDir');

        if (!downloadDir) {
            console.error('Error: downloadDir no está definido en el store.');
            return [];
        }

        const historyFile = path.join(downloadDir, 'sync-history.json');

        if (fs.existsSync(historyFile)) {
            try {
                const historyData = fs.readFileSync(historyFile, 'utf8');
                return JSON.parse(historyData);
            } catch (error) {
                console.error('Error al leer o parsear el historial de sincronización:', error);
                return [];
            }
        } else {
            // Crear el archivo si no existe
            try {
                fs.writeFileSync(historyFile, '[]', 'utf8');
                console.warn('El archivo de historial no existía, se ha creado uno nuevo:', historyFile);
                return [];
            } catch (error) {
                console.error('Error al crear el archivo de historial:', error);
                return [];
            }
        }
    }
};
