//sync.js
const { ipcMain } = require('electron');
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

/*
aqui parece que intenta descargar varios audios al mismo tiempo, y se guardan 2 registros 

  {
    "timestamp": "2024-12-24T18:26:07.868Z",
    "eventType": "download",
    "userId": "355",
    "audio": "C:\\Users\\1u\\Documents\\test\\Sync 2upra (1)\\samples-hip-hop-soul\\You-And-I_GzvM_2upra.wav",
    "image": "C:\\Users\\1u\\Documents\\test\\Sync 2upra (1)\\.hidden_images\\pincase202411038389-3.jpeg"
  },
  {
    "timestamp": "2024-12-24T18:26:11.927Z",
    "eventType": "download",
    "userId": "355",
    "audio": "C:\\Users\\1u\\Documents\\test\\Sync 2upra (1)\\samples-hip-hop-soul\\You-And-I_GzvM_2upra.wav",
    "image": "C:\\Users\\1u\\Documents\\test\\Sync 2upra (1)\\.hidden_images\\pincase202411038389-3.jpeg"
  },

  al final solo hay un audio pero es molesto ver el registro 2 veces, puedes verificar 
*/

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

const syncSingleAudio = async (userId, postId, downloadDir) => {
    const url = `${API_BASE}/1/v1/syncpre/${userId}?post_id=${postId}`;
    try {
        const response = await axios.get(url, {
            headers: {'X-Electron-App': 'true'},
            withCredentials: true
        });

        const audioToDownload = response.data[0];

        if (!audioToDownload || !audioToDownload.download_url) {
            return;
        }

        const collectionDir = path.join(downloadDir, audioToDownload.collection);
        const favoritesDir = path.join(collectionDir, 'favorites');
        const audioFilePath = path.join(collectionDir, audioToDownload.audio_filename);
        const favoriteAudioFilePath = path.join(favoritesDir, audioToDownload.audio_filename);
        let audioDownloadedOrMoved = false; // Track if audio was downloaded or moved

        if (!fs.existsSync(collectionDir)) {
            fs.mkdirSync(collectionDir, {recursive: true});
        }

        if (audioToDownload.es_favorito) {
            if (!fs.existsSync(favoritesDir)) {
                fs.mkdirSync(favoritesDir, { recursive: true });
            }
            if (fs.existsSync(audioFilePath) && !fs.existsSync(favoriteAudioFilePath)) {
                fs.renameSync(audioFilePath, favoriteAudioFilePath);
                audioDownloadedOrMoved = true;
            } else if (!fs.existsSync(favoriteAudioFilePath)) {
                await downloadFile(audioToDownload.download_url, favoriteAudioFilePath);
                audioDownloadedOrMoved = true;
            }
        } else {
            if (!fs.existsSync(audioFilePath)) {
                await downloadFile(audioToDownload.download_url, audioFilePath);
                audioDownloadedOrMoved = true;
            }
        }

        let imagePath = null;
        if (audioToDownload.image) {
            const tempImageDir = path.join(downloadDir, '.hidden_images');
            const fileName = path.basename(new URL(audioToDownload.image).pathname);
            imagePath = path.join(tempImageDir, fileName);

            if (!fs.existsSync(imagePath)) {
                const imageResult = await handleImageDownload(audioToDownload.image, tempImageDir);
                imagePath = imageResult.filePath;
                // imageDownloaded = imageResult.downloaded; // Removed as not used in syncSingleAudio
            }
        }

        // Log event only if audio was downloaded or moved
        if (audioDownloadedOrMoved) {
            logSyncEvent('download', {userId, audioFilePath: audioToDownload.es_favorito ? favoriteAudioFilePath : audioFilePath, imagePath});
            ipcMain.emit('sync-file-downloaded', {audioFilePath: audioToDownload.es_favorito ? favoriteAudioFilePath : audioFilePath, imagePath});
        }
    } catch (error) {
        console.error('[syncSingleAudio] Error al sincronizar audio individual:', error);
    }
};

const syncAudios = async (userId, downloadDir) => {
    const url = `${API_BASE}/1/v1/syncpre/${userId}`;
    try {
        const response = await axios.get(url, {
            headers: {'X-Electron-App': 'true'},
            withCredentials: true
        });

        const audiosToDownload = response.data;
        if (!audiosToDownload || audiosToDownload.length === 0) {
            cleanDownloadDir(downloadDir);
        } else {
            prepareDownloadDir(downloadDir, audiosToDownload);
            const tempImageDir = path.join(downloadDir, '.hidden_images');

            for (const audio of audiosToDownload) {
                let audioFilePath = null;
                let imagePath = null;
                let audioDownloadedOrMoved = false;
                let imageDownloaded = false;

                if (audio.download_url) {
                    const result = await handleFileDownload(audio, downloadDir, userId);
                    audioFilePath = result.filePath;
                    audioDownloadedOrMoved = result.downloadedOrMoved;
                }

                if (audio.image) {
                    const imageResult = await handleImageDownload(audio.image, tempImageDir);
                    imagePath = imageResult.filePath;
                    imageDownloaded = imageResult.downloaded;
                }

                if (audioDownloadedOrMoved || imageDownloaded) {
                    logSyncEvent('download', {
                        userId,
                        audio: audioFilePath,
                        image: imagePath
                    });
                    ipcMain.emit('sync-file-downloaded', {audioFilePath, imagePath});
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
    const favoritesDir = path.join(collectionDir, 'favorites');
    const filePath = path.join(collectionDir, audio.audio_filename);
    const favoriteFilePath = path.join(favoritesDir, audio.audio_filename);

    if (!fs.existsSync(collectionDir)) {
        fs.mkdirSync(collectionDir, {recursive: true});
    }

    let downloadedOrMoved = false;
    if (audio.es_favorito) {
        if (!fs.existsSync(favoritesDir)) {
            fs.mkdirSync(favoritesDir, { recursive: true });
        }

        if (fs.existsSync(filePath) && !fs.existsSync(favoriteFilePath)) {
            // Move to favorites
            fs.renameSync(filePath, favoriteFilePath);
            downloadedOrMoved = true;
        } else if (!fs.existsSync(favoriteFilePath)) {
            // Download directly to favorites
            await downloadFile(audio.download_url, favoriteFilePath);
            downloadedOrMoved = true;
        }
    } else {
        // If not a favorite, download to collection if it doesn't exist
        if (!fs.existsSync(filePath)) {
            await downloadFile(audio.download_url, filePath);
            downloadedOrMoved = true;
        }
    }

    return { filePath: audio.es_favorito ? favoriteFilePath : filePath, downloadedOrMoved };
};

const prepareDownloadDir = (downloadDir, audiosToDownload) => {
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, {recursive: true});
    }

    const remoteFilePaths = new Set(
        audiosToDownload.map(audio => {
            const collectionDir = path.join(downloadDir, audio.collection);
            const filePath = path.join(collectionDir, audio.audio_filename);
            return filePath;
        })
    );

    const tempImageDir = path.join(downloadDir, '.hidden_images');
    if (!fs.existsSync(tempImageDir)) {
        fs.mkdirSync(tempImageDir, {recursive: true});
        if (process.platform === 'win32') {
            const {exec} = require('child_process');
            exec(`attrib +h "${tempImageDir}"`);
        }
    }

    const remoteImagePaths = new Set(
        audiosToDownload
            .filter(audio => !!audio.image)
            .map(audio => {
                const fileName = path.basename(new URL(audio.image).pathname);
                return path.join(tempImageDir, fileName);
            })
    );

    remoteImagePaths.forEach(imagePath => remoteFilePaths.add(imagePath));

    cleanLocalFiles(downloadDir, remoteFilePaths);
    cleanImageDir(tempImageDir, remoteImagePaths);
};


const handleImageDownload = async (imageUrl, tempDir) => {
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, {recursive: true});
        }

        const fileName = path.basename(new URL(imageUrl).pathname);
        const filePath = path.join(tempDir, fileName);

        // Solo descargar si el archivo no existe
        if (!fs.existsSync(filePath)) {
            const response = await axios.get(imageUrl, {responseType: 'arraybuffer'});
            // fs.writeFileSync(filePath, Buffer.from(response.data)); // Esta línea es equivalente a la siguiente
            fs.writeFileSync(filePath, response.data); // Más conciso y directo, ya que response.data ya es un Buffer
            return {filePath, downloaded: true}; // Indicar que se descargo
        }

        return {filePath, downloaded: false}; // Indicar que ya existía
    } catch (error) {
        console.error('[handleImageDownload] Error al descargar o manejar la imagen:', error);
        // En lugar de lanzar el error, podrías retornar un objeto con una propiedad de error
        // para que la función que llama a handleImageDownload pueda manejar el error sin detener la ejecución.
        // throw error;
        return { filePath: null, downloaded: false, error: error.message }; // Retorna un objeto con información del error
    }
};

const checkForChangesAndSync = async (userId, downloadDir) => {
    const lastSyncTimestamp = store?.get('lastSyncTimestamp') || 0;
    const checkUrl = `${API_BASE}/1/v1/syncpre/${userId}/check?last_sync=${lastSyncTimestamp}`;
    try {
        console.log(`PARA QUE SIRVE ESTO ${lastSyncTimestamp}`);
        console.log('[checkForChangesAndSync] Iniciando peticion a la API...');
        const response = await axios.get(checkUrl, {
            headers: { 'X-Electron-App': 'true' },
            withCredentials: true
        });
        const { descargas_modificado, samplesGuardados_modificado } = response.data;
        if (descargas_modificado > lastSyncTimestamp || samplesGuardados_modificado > lastSyncTimestamp) {
            await syncAudios(userId, downloadDir);
            // Actualizar la marca de sincronización
            const newLastSyncTimestamp = Math.max(descargas_modificado || 0, samplesGuardados_modificado || 0);
            store?.set('lastSyncTimestamp', newLastSyncTimestamp); // Actualizamos el timestamp
            console.log(`[checkForChangesAndSync] Nueva marca de sincronizacion almacenada: ${newLastSyncTimestamp}`);
        } else {
            console.log('[checkForChangesAndSync] No se detectaron cambios, no se realiza sincronizacion.');
        }
    } catch (error) {
        console.error('[checkForChangesAndSync] Error al verificar cambios:', error);
    }
};



const cleanImageDir = (tempImageDir, remoteImagePaths) => {
    if (!fs.existsSync(tempImageDir)) return;
    const localImages = fs.readdirSync(tempImageDir).map(file => path.join(tempImageDir, file));
    for (const localImage of localImages) {
        if (!remoteImagePaths.has(localImage)) {
            fs.unlinkSync(localImage);
            logSyncEvent('delete-image', {filePath: localImage});
        }
    }
};

const cleanLocalFiles = (downloadDir, remoteFilePaths) => {
    const localFiles = [];
    const recursivelyFindFiles = dir => {
        const items = fs.readdirSync(dir);
        items.forEach(item => {
            const fullPath = path.join(dir, item);
            if (fs.statSync(fullPath).isDirectory()) {
                if (path.basename(fullPath) === '.hidden_images') return;
                recursivelyFindFiles(fullPath);
            } else {
                if (item !== 'sync-history.json') localFiles.push(fullPath);
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
        fs.rmSync(downloadDir, {recursive: true, force: true});
        logSyncEvent('delete-all', {downloadDir});
        const tempImageDir = path.join(downloadDir, '.hidden_images');
        cleanImageDir(tempImageDir);
    }
};

const startSyncing = (userId, downloadDir) => {
    if (syncInterval) clearInterval(syncInterval);

    syncInterval = setInterval(() => checkForChangesAndSync(userId, downloadDir), DOWNLOAD_INTERVAL_MS);
    checkForChangesAndSync(userId, downloadDir);

    store.set('userId', userId);
    store.set('downloadDir', downloadDir);
};

const logSyncEvent = (eventType, details) => {
    const historyFile = path.join(store.get('downloadDir'), 'sync-history.json');
    const timestamp = new Date().toISOString();
    const event = {timestamp, eventType, ...details}; 
    let history = [];
    const maxHistoryLength = 50; // Define el máximo de elementos del historial

    if (fs.existsSync(historyFile)) {
        try {
            history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        } catch (error) {
            console.error('Error al leer el historial de sincronizacion:', error);
        }
    }

    history.push(event);

    // Ordenar el historial por timestamp de más reciente a más antiguo
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Conservar solo los últimos 'maxHistoryLength' elementos
    if (history.length > maxHistoryLength) {
        history = history.slice(0, maxHistoryLength);
    }

    try {
        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');
    } catch (error) {
        console.error('Error al guardar el historial de sincronizacion:', error);
    }

    ipcMain.emit('sync-history-updated', history);
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
                console.error('Error al leer o parsear el historial de sincronizacion:', error);
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
