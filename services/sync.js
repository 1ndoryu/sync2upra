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
        const userId = store.get('userId');
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
        if (!audioToDownload || !audioToDownload.download_url) return;

        const collectionDir = path.join(downloadDir, audioToDownload.collection);
        if (!fs.existsSync(collectionDir)) {
            fs.mkdirSync(collectionDir, {recursive: true});
        }
        const filePath = path.join(collectionDir, audioToDownload.audio_filename);
        await downloadFile(audioToDownload.download_url, filePath);

        logSyncEvent('download', {userId, filePath});
        ipcMain.emit('sync-file-downloaded', filePath);
    } catch (error) {
        console.error('Error al sincronizar audio individual:', error);
    }
};
//sync.js

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

            for (const audio of audiosToDownload) {
                if (audio.download_url) {
                    await handleFileDownload(audio, downloadDir, userId);
                }
            }
            lastSyncTimestamp = Math.floor(Date.now() / 1000);
            store?.set('lastSyncTimestamp', lastSyncTimestamp);
        }

        ipcMain.emit('sync-completed'); // Emitir el evento siempre
    } catch (error) {
        console.error('Error al sincronizar audios:', error);
        ipcMain.emit('sync-error', error); // Emitir evento de error
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

const prepareDownloadDir = (downloadDir, audiosToDownload) => {
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, {recursive: true});
    }

    const remoteFilePaths = new Set(
        audiosToDownload.map(audio => {
            const collectionDir = path.join(downloadDir, audio.collection);
            return path.join(collectionDir, audio.audio_filename);
        })
    );

    cleanLocalFiles(downloadDir, remoteFilePaths);
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
        fs.rmSync(downloadDir, {recursive: true, force: true});
        logSyncEvent('delete-all', {downloadDir});
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
