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
        const favoritesDir = path.join(downloadDir, 'favoritos'); // New: Favorites directory

        if (!fs.existsSync(collectionDir)) {
            fs.mkdirSync(collectionDir, {recursive: true});
        }

        if (audioToDownload.es_favorito && !fs.existsSync(favoritesDir)) { // New: Create favorites directory if it's a favorite
            fs.mkdirSync(favoritesDir, { recursive: true });
        }

        const audioFilePath = path.join(collectionDir, audioToDownload.audio_filename);
        const favoriteAudioFilePath = path.join(favoritesDir, audioToDownload.audio_filename); // New: Path in favorites directory

        await downloadFile(audioToDownload.download_url, audioFilePath);

        if (audioToDownload.es_favorito) {
            fs.copyFileSync(audioFilePath, favoriteAudioFilePath); // New: Copy to favorites if needed
        }

        let imagePath = null;
        if (audioToDownload.image) {
            const tempImageDir = path.join(downloadDir, '.hidden_images');
            const fileName = path.basename(new URL(audioToDownload.image).pathname);
            imagePath = path.join(tempImageDir, fileName);

            if (!fs.existsSync(imagePath)) {
                imagePath = await handleImageDownload(audioToDownload.image, tempImageDir);
            }
        }

        logSyncEvent('download', {userId, audioFilePath, imagePath});
        ipcMain.emit('sync-file-downloaded', {audioFilePath, imagePath});
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
            const favoritesDir = path.join(downloadDir, 'favoritos');

            for (const audio of audiosToDownload) {
                let audioFilePath = null;
                let imagePath = null;
                let audioDownloaded = false;
                let imageDownloaded = false;
            
                if (audio.download_url) {
                    const result = await handleFileDownload(audio, downloadDir, userId, favoritesDir); // Modified to handle favorites
                    audioFilePath = result.filePath;
                    audioDownloaded = result.downloaded;
                }
            
                if (audio.image) {
                    const imageResult = await handleImageDownload(audio.image, tempImageDir);
                    imagePath = imageResult.filePath;
                    imageDownloaded = imageResult.downloaded;
                }
            
                // Solo registrar si se descargo algo nuevo
                if (audioDownloaded || imageDownloaded) {
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

const handleFileDownload = async (audio, downloadDir, userId, favoritesDir) => {
    const collectionDir = path.join(downloadDir, audio.collection);

    if (!fs.existsSync(collectionDir)) {
        fs.mkdirSync(collectionDir, {recursive: true});
    }

    const filePath = path.join(collectionDir, audio.audio_filename);
    const favoriteFilePath = audio.es_favorito ? path.join(favoritesDir, audio.audio_filename) : null;

    let downloaded = false;
    if (!fs.existsSync(filePath)) {
        await downloadFile(audio.download_url, filePath);
        downloaded = true;
    }

    if (audio.es_favorito) {
        if (!fs.existsSync(favoritesDir)) {
            fs.mkdirSync(favoritesDir, { recursive: true });
        }
        if (!fs.existsSync(favoriteFilePath)) {
            fs.copyFileSync(filePath, favoriteFilePath);
        }
    }

    return { filePath, downloaded };
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
            fs.writeFileSync(filePath, Buffer.from(response.data));
            return {filePath, downloaded: true}; // Indicar que se descargo
        }

        return {filePath, downloaded: false}; // Indicar que ya existía
    } catch (error) {
        console.error('[handleImageDownload] Error al descargar o manejar la imagen:', error);
        throw error;
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
    const event = {timestamp, eventType, ...details}; // Unificar detalles
    let history = [];

    if (fs.existsSync(historyFile)) {
        try {
            history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        } catch (error) {
            console.error('Error al leer el historial de sincronizacion:', error);
        }
    }

    history.push(event);

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
