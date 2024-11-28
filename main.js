//En main.js
const {app, BrowserWindow, ipcMain, session, Tray, Menu, dialog, shell, contextBridge} = require('electron');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path'); // Mueve esta línea aquí
const configFilePath = path.join(app.getPath('userData'), 'config.json');
const {sync, getSyncHistory} = require('./services/sync.js');
const fs = require('fs');

let mainWindow, appWindow, tray;
let isAppWindowVisible = false;
let userId = null;

let Store;
let store;

//porque si cambio "userId": en config, si ya habia una y cambio a otra, la app inicia con esa id, o sea la seguridad no esta funcionando, debe cerrarse automaticamente si el usuario cambio el userid en la config y evitar que continue
(async () => {
    Store = (await import('electron-store')).default;
    store = new Store();

    app.whenReady().then(async () => {
        session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
            details.requestHeaders['X-Electron-App'] = 'true';
            callback({requestHeaders: details.requestHeaders});
        });

        // Cargar userId al iniciar la aplicación
        userId = store.get('userId') || null;

        ipcMain.handle('get-user-id', async () => {
            console.log('Obteniendo userId en get-user-id:', userId);
            return userId;
        });
        ipcMain.handle('get-download-dir', getDownloadDirectory);
        createTray();

        const token = store.get('authToken');

        if (token) {
            try {
                const {userId: verifiedUserId} = await verifyToken(token);
                const storedUserId = store.get('userId');

                if (verifiedUserId && verifiedUserId === storedUserId) {
                    userId = verifiedUserId;
                    createAppWindow(token);
                } else {
                    console.error('UserId almacenado no coincide con el userId verificado. Invalida el token.');
                    sync?.stopSyncing?.();
                    app.quit();

                }
            } catch (error) {
                console.error('Error al verificar el token al iniciar:', error);

            }
        } else {
            console.log('No hay token de autenticación presente.');
            createMainWindow();
        }
    });
})();

ipcMain.on('auth-token', (event, token) => {
    console.log('Token recibido desde main:', token);
    verifyToken(token)
        .then(({ userId: newUserId, newToken }) => {

            userId = newUserId;
            store.set('userId', userId);
            if (newToken) {
                store.set('authToken', newToken);
            } else {
                store.set('authToken', token); 
            }
            if (!appWindow) {
                createAppWindow(newToken || token);
            } else {
                appWindow.reload();
            }
        })
        .catch(error => {
            console.error('Error al verificar el token recibido:', error);
            handleInvalidToken();
        });

    setInterval(() => {
        const currentToken = store.get('authToken');
        if (currentToken) {
            verifyToken(currentToken)
                .then(({ userId: newUserId, newToken }) => {
                    userId = newUserId;
                    store.set('userId', userId);
                    if (newToken) {
                        store.set('authToken', newToken);
                    }
                })
                .catch(error => {
                    console.error('Error en la verificación periódica del token:', error);
                    handleInvalidToken();
                });
        }
    }, 600000);
});

ipcMain.on('fetchData', async (event, args) => {
    console.log('fetchData event received in renderer.js with args:', args);

    try {
        const authToken = store.get('authToken');

        if (authToken) {
            console.log('AuthToken encontrado en storage:', authToken);
            ipcMain.send('auth-token-reply', authToken);
            console.log('AuthToken enviado a main.js');
        } else {
            console.log('No hay authToken en storage');
            handleInvalidToken();
        }
    } catch (error) {
        console.error('Error en fetchData:', error);
        handleInvalidToken();
    }
});;

function createMainWindow() {
    console.log('Creando ventana principal...');
    mainWindow = new BrowserWindow({
        width: 600,
        height: 600,
        frame: false,
        resizable: true,
        hasShadow: true,
        roundedCorners: true,
        webPreferences: {preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, devTools: false}
    });
    mainWindow.loadURL('https://2upra.com');
    mainWindow.on('closed', () => (mainWindow = null));
    mainWindow.webContents.on('did-redirect-navigation', async (event, url) => {
        console.log('--- Redirección detectada ---');
        console.log('URL redirigida:', url);

        if (url.startsWith('https://2upra.com/app')) {
            const token = new URL(url).searchParams.get('token');
            console.log('Token extraído de la URL:', token);

            if (token) {
                try {
                    console.log('Verificando el token...');
                    const newUserId = await verifyToken(token);
                    if (newUserId) {
                        console.log('Token válido. Creando ventana de la aplicación.');
                        userId = newUserId; // Actualiza la variable global
                        store.set('userId', userId);
                        store.set('authToken', token);
                        createAppWindow(token);
                    }
                } catch (error) {
                    console.error('Error al verificar el token:', error);
                    // Puedes mostrar un mensaje de error o redirigir a la página de inicio
                }
            } else {
                console.warn('No se encontró un token en la redirección.');
            }
        }
    });
    return mainWindow;
}


async function verifyToken(token) {
    console.log('--- Iniciando la verificación del token ---');
    console.log('Token recibido para verificar:', token);

    return new Promise(async (resolve, reject) => {
        try {
            const response = await fetch('https://2upra.com/wp-json/2upra/v1/verify_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({token: token})
            });

            console.log('--- Respuesta del servidor recibida ---');
            console.log('Status de la respuesta:', response.status, response.statusText);

            if (!response.ok) {
                console.error('Error en la respuesta del servidor (no es OK):', response.status, response.statusText);
                handleInvalidToken();
                reject('Error en la respuesta del servidor');
                return;
            }

            const data = await response.json();
            console.log('Datos del servidor:', data);

            if (data.status === 'valid') {
                console.log('Token válido. UserId:', data.user_id);
                resolve({ userId: data.user_id, newToken: data.new_token }); // Devuelve ambos
            } else {
                console.log('Token inválido. Estado:', data.status, 'Mensaje:', data.message);
                handleInvalidToken();
                reject('Token inválido');
            }
        } catch (error) {
            console.error('Error al verificar el token (excepción):', error);
            handleInvalidToken();
            reject('Error al verificar el token');
        }
    });
}

function handleInvalidToken() {
    console.log('Manejando token inválido...');
    store.delete('authToken');
    store.delete('userId');
    userId = null;
    if (appWindow) {
        appWindow.close();
        appWindow = null;
    }
    if (mainWindow) {
        mainWindow.show();
    } else {
        createMainWindow();
    }
}
function createAppWindow() {
    console.log('Creando ventana de la aplicación...');
    appWindow = new BrowserWindow({
        width: 350,
        height: 500,
        frame: false,
        resizable: false,
        hasShadow: true,
        roundedCorners: true,
        transparent: true,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, devTools: true }
    });

    const userId = store.get('userId');
    if (userId) {
        console.log('UserId recuperado de storage:', userId);
        appWindow.userId = userId;
    } else {
        console.error('UserId no encontrado en el storage. Cerrando la aplicación.');
        store.delete('authToken');  // Borra el token si el userId no está disponible
        appWindow?.close();
        return;
    }

    appWindow.loadFile('./src/renderer/index.html');
    
    appWindow.webContents.once('dom-ready', () => appWindow.webContents.openDevTools({ mode: 'detach' }));
    appWindow.once('ready-to-show', () => mainWindow?.close());
    appWindow.on('blur', () => isAppWindowVisible && hideAppWindow());
    appWindow.on('close', event => (app.quitting ? (appWindow = null) : (event.preventDefault(), appWindow.hide(), (isAppWindowVisible = false))));

    return appWindow;
}
//FUNCIONES

async function getDownloadDirectory() {
    let config = {};
    if (fs.existsSync(configFilePath)) {
        try {
            config = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
            if (config.downloadDir) return config.downloadDir;
            else console.warn('Archivo config sin "downloadDir".');
        } catch (error) {
            console.error('Error al leer o parsear config:', error);
        }
    }
    const result = await dialog.showOpenDialog({properties: ['openDirectory']});
    if (!result.canceled && result.filePaths.length > 0) {
        const downloadDir = result.filePaths[0];
        try {
            config.downloadDir = downloadDir;
            fs.writeFileSync(configFilePath, JSON.stringify(config));
            return downloadDir;
        } catch (error) {
            console.error('Error al guardar config:', error);
        }
    }
    return null;
}

function createTray() {
    tray = new Tray(path.join(__dirname, 'icon.png'));
    tray.setToolTip('2upra');
    tray.setContextMenu(
        Menu.buildFromTemplate([
            {label: 'Abrir aplicación', click: showAppWindow},
            {label: 'Salir', click: app.quit}
        ])
    );
    tray.on('click', toggleAppWindow);
}

function toggleAppWindow() {
    appWindow && (isAppWindowVisible ? hideAppWindow() : showAppWindow());
}

function showAppWindow() {
    if (!appWindow || isAppWindowVisible) return;
    const {
        workArea: {width: screenWidth, height: screenHeight, x: screenX, y: screenY}
    } = require('electron').screen.getPrimaryDisplay();
    const trayBounds = tray.getBounds();
    const windowBounds = appWindow.getBounds();
    const centerX = trayBounds.x + trayBounds.width / 2;
    const isCloserToLeft = centerX < screenWidth / 2;
    let x = isCloserToLeft ? screenX : screenX + screenWidth - windowBounds.width;
    let y = Math.max(screenY, Math.min(Math.round(trayBounds.y + trayBounds.height), screenY + screenHeight - windowBounds.height));
    appWindow.setBounds({x, y, width: windowBounds.width, height: windowBounds.height});
    appWindow.show();
    isAppWindowVisible = true;
}

function hideAppWindow() {
    if (appWindow && isAppWindowVisible) {
        appWindow.hide();
        isAppWindowVisible = false;
    }
}

//HANDLE
ipcMain.handle('fetch-user-profile', async (_, receptorId) => {
    const apiUrl = 'https://2upra.com/wp-json/1/v1/infoUsuario';
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Electron-App': 'true'
            },
            body: JSON.stringify({receptor: receptorId})
        });
        const data = await response.json();
        if (data.imagenPerfil) {
            return data;
        } else {
            throw new Error(data.message || 'API Error');
        }
    } catch (error) {
        console.error('Error fetching user profile:', error);
        return null;
    }
});

ipcMain.handle('get-sync-history', async () => {
    const history = await getSyncHistory();
    return history.map(event => {
        const {timestamp, eventType, details} = event;
        const filePath = details.filePath;
        const folderName = path.basename(path.dirname(filePath));
        const fileName = path.basename(filePath);
        return {
            timestamp,
            eventType,
            details: {
                ...details,
                folderName,
                fileName
            }
        };
    });
});

ipcMain.handle('open-folder', async (event, filePath) => {
    shell.showItemInFolder(filePath);
});

ipcMain.on('sync-completed', () => {
    appWindow?.webContents.send('sync-completed');
});

ipcMain.on('start-sync', async (event, {userId, downloadDir}) => {
    try {
        if (typeof sync?.startSyncing === 'function') {
            await sync.startSyncing(userId, downloadDir);
        } else {
            console.error('sync.startSyncing no definido');
        }
    } catch (error) {
        console.error('Error en start-sync:', error);
        event.reply('sync-error', {error: error.message});
    }
});

ipcMain.on('sync-single-audio', async (event, {userId, postId}) => {
    const downloadDir = await getDownloadDirectory();
    if (downloadDir) {
        sync.syncSingleAudio(userId, postId, downloadDir);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        sync?.stopSyncing?.();
        app.quit();
    }
});

app.on('before-quit', () => {
    sync?.stopSyncing?.();
    app.quitting = true;
});

app.on('activate', () => {
    BrowserWindow.getAllWindows().length === 0 ? (appWindow ? showAppWindow() : createMainWindow()) : null;
});
ipcMain.on('logout', async () => {
    try {
        await session.defaultSession.clearStorageData({storages: ['cookies']});
        try {
            await fs.promises.unlink(configFilePath);
        } catch (error) {
            console.error('Error al eliminar el archivo de configuración:', error);
        }
        if (appWindow) {
            appWindow.userId = null;
            appWindow.close();
            appWindow = null;
        }
        if (mainWindow) {
            mainWindow.close();
            mainWindow = null;
        }
        app.relaunch();
        app.quit();
    } catch (error) {
        console.error('Error al limpiar cookies:', error);
    }
});

ipcMain.on('cambiarCarpeta', async event => {
    try {
        const result = await dialog.showOpenDialog({properties: ['openDirectory']});
        if (!result.canceled && result.filePaths.length > 0) {
            const newDownloadDir = result.filePaths[0];
            let config = fs.existsSync(configFilePath) ? JSON.parse(fs.readFileSync(configFilePath, 'utf8')) : {};
            config.downloadDir = newDownloadDir;
            fs.writeFileSync(configFilePath, JSON.stringify(config));
            //event.reply('carpeta-cambiada', newDownloadDir);
        }
    } catch (error) {
        console.error('Error al cambiar de carpeta:', error);
        //event.reply('carpeta-cambiada-error', error.message);
    }
});

ipcMain.on('reiniciar', async () => {
    if (appWindow) {
        appWindow.close();
        appWindow = null;
    }
    if (mainWindow) {
        mainWindow.close();
        mainWindow = null;
    }
    app.relaunch();
    app.exit(0);
});
