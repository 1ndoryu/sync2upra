const {app, BrowserWindow, ipcMain, session, Tray, Menu, dialog, shell, contextBridge} = require('electron');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');
const configFilePath = path.join(app.getPath('userData'), 'config.json');
const {sync, getSyncHistory} = require('./services/sync.js');
const fs = require('fs');
const log = require('electron-log');
const {autoUpdater} = require('electron-updater');

let mainWindow, appWindow, tray;
let isAppWindowVisible = false;
let userId = null;

let Store;
let store;

(async () => {
    Store = (await import('electron-store')).default;
    store = new Store();
    autoUpdater.logger = require('electron-log');
    autoUpdater.logger.transports.file.level = 'info';
    autoUpdater.autoDownload = false;

    app.whenReady().then(async () => {
        session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
            details.requestHeaders['X-Electron-App'] = 'true';
            callback({requestHeaders: details.requestHeaders});
        });

        userId = store.get('userId')?.userId || null;

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
                const storedUserId = store.get('userId')?.userId;

                if (verifiedUserId && verifiedUserId === storedUserId) {
                    userId = verifiedUserId;
                    createAppWindow(token);
                    autoUpdater.checkForUpdates();
                } else {
                    console.error('UserId almacenado no coincide con el userId verificado. Invalida el token.');
                    console.log('UserId almacenado:', storedUserId, typeof storedUserId);
                    console.log('UserId verificado:', verifiedUserId, typeof verifiedUserId);
                    sync?.stopSyncing?.();
                    //app.quit();
                    createMainWindow();
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
                userId = data.user_id;
                store.set('userId', {userId});
                store.set('authToken', token);
                resolve({userId: data.user_id});
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
                    const response = await verifyToken(token);
                    const newUserId = response.userId;
                    if (newUserId) {
                        console.log('Token válido. Creando ventana de la aplicación.');
                        userId = newUserId;
                        store.set('userId', {userId});
                        store.set('authToken', token);
                        createAppWindow(token);
                        autoUpdater.checkForUpdates();
                    }
                } catch (error) {
                    console.error('Error al verificar el token:', error);
                }
            } else {
                console.warn('No se encontró un token en la redirección.');
            }
        }
    });
    return mainWindow;
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
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: false
        }
    });

    const userId = store.get('userId');
    if (userId) {
        console.log('UserId recuperado de storage:', userId);
        appWindow.userId = userId;
    } else {
        console.error('UserId no encontrado en el storage. Cerrando la aplicación.');
        store.delete('authToken');
        appWindow?.close();
        return;
    }

    appWindow.loadFile('./src/renderer/index.html');

    // Abre las herramientas de desarrollo automáticamente
    // appWindow.webContents.openDevTools();

    // Eventos de la ventana
    appWindow.once('ready-to-show', () => mainWindow?.close());
    appWindow.on('blur', () => isAppWindowVisible && hideAppWindow());
    appWindow.on('close', event => {
        if (!app.quitting) {
            event.preventDefault();
            appWindow.hide();
            isAppWindowVisible = false;
        } else {
            appWindow = null;
        }
    });

    return appWindow;
}

// Eventos de electron-updater
autoUpdater.on('checking-for-update', () => {
    console.log('Buscando actualizaciones...');
});

autoUpdater.on('update-available', info => {
    console.log('Actualización disponible:', info);
    dialog
        .showMessageBox({
            type: 'info',
            title: 'Actualización disponible',
            message: `Hay una nueva versión de Sync 2upra disponible (${info.version}). ¿Quieres descargarla ahora?`,
            buttons: ['Sí', 'No']
        })
        .then(response => {
            if (response.response === 0) {
                autoUpdater.downloadUpdate();
            }
        });
});

autoUpdater.on('update-not-available', info => {
    console.log('No hay actualizaciones disponibles:', info);
});

autoUpdater.on('error', err => {
    console.error('Error al actualizar:', err);
});

autoUpdater.on('download-progress', progress => {
    console.log(`Descargando actualización - Progreso: ${progress.percent}%`);
});

autoUpdater.on('update-downloaded', info => {
    console.log('Actualización descargada:', info);
    dialog
        .showMessageBox({
            type: 'info',
            title: 'Actualización lista',
            message: `La versión ${info.version} ha sido descargada. Reinicia la aplicación para instalarla.`,
            buttons: ['Reiniciar', 'Más tarde']
        })
        .then(response => {
            if (response.response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
});

//No funciona esto <button id="cambiarCarpeta">Selecionar carpeta</button>
ipcMain.on('cambiarCarpeta', async event => {
    try {
        // Llamar a getDownloadDirectory() para usar la misma lógica
        const newDownloadDir = await getDownloadDirectory();
        
        if (newDownloadDir) {
            event.reply('carpeta-cambiada', newDownloadDir);
        }
    } catch (error) {
        console.error('Error al cambiar de carpeta:', error);
        event.reply('carpeta-cambiada-error', error.message);
    }
});

async function getDownloadDirectory() {
    let config = {};
    if (fs.existsSync(configFilePath)) {
        try {
            config = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
            if (config.downloadDir) return config.downloadDir;
        } catch (error) {
            console.error('Error al leer o parsear config:', error);
        }
    }

    // Crear estilos CSS personalizados
    const customCSS = `
        :root {
            --fondo: #070707;
            --borde: 1px #161616 solid;
            --radius: 5px;
            --bordeBoton: 1px #1f1f1f8c solid;
            --padding: 20px;
            --ancho: 600px;
            --font: 11px;
            --color: #d4d4d4;
            --line-height: 1.6;
        }
        @font-face {
            font-family: 'Source Sans 3';
            src: url('src/fonts/SourceSans3-Regular.woff2') format('woff2');
            font-weight: 400;
            font-style: normal;
        }

        html, body {
            background: transparent !important;
            margin: 0;
            padding: 0;
            overflow: hidden;
        }

        body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
        }

        .dialog {
            max-width: var(--ancho);
            margin: auto;
            background-color: var(--fondo);
            color: var(--color);
            font-size: var(--font);
            line-height: var(--line-height);
            padding: var(--padding);
            border-radius: var(--radius);
            padding-top: 10px;
        }

        button {
            background-color: var(--fondo);
            border: var(--bordeBoton);
            color: var(--color);
            border-radius: var(--radius);
            padding: 8px 16px;
            cursor: pointer;
            font-size: 11px;
            opacity: 0.8;
        }
        
        .fl {
            display: flex;
            gap: 10px;
        }

        * {
            user-select: none;
            user-drag: none;
            app-region: no-drag;
            padding: 0;
            box-sizing: border-box;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
        }
        
        p {
        opacity: 0.8;
        }

        body,
        body p,
        textarea {
            font-family: 'Source Sans 3', Arial, Helvetica, sans-serif !important;
            font-weight: 400px;
            font-style: normal;
            color: #d4d4d4;
            line-height: 1.6;
            letter-spacing: 0px;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
            text-decoration: none;
            text-wrap: pretty;
            
        }

        button:hover {
            background-color: #1a1a1a;
        }
    `;

    // Crear una ventana personalizada
    const customWindow = new BrowserWindow({
        width: 600,
        height: 170,
        backgroundColor: '#00000000', // Fondo transparente
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        frame: false,
        transparent: true,
        resizable: false,
        hasShadow: false // Opcional: elimina la sombra de la ventana
    });

    // Crear contenido HTML
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>${customCSS}</style>
        </head>
        <body>
            <div class="dialog">
                <p>Seleccionar Carpeta de Descargas</p>
                <p>Por favor, selecciona la carpeta donde se creará el directorio "Sync 2upra" para guardar los archivos.</p>
                <div class="fl">  
                    <button id="selectFolder">Seleccionar Carpeta</button>
                    <button id="cancel">Cancelar</button>
                </div>
            </div>
            <script>
                const { ipcRenderer } = require('electron');
                
                document.getElementById('selectFolder').addEventListener('click', () => {
                    ipcRenderer.send('select-folder');
                });

                document.getElementById('cancel').addEventListener('click', () => {
                    ipcRenderer.send('cancel-selection');
                });
            </script>
        </body>
        </html>
    `;

    // Cargar el contenido HTML en la ventana
    customWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    // Manejar la selección de carpeta
    ipcMain.once('select-folder', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            defaultPath: app.getPath('downloads'),
            buttonLabel: 'Seleccionar esta carpeta'
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const baseDir = result.filePaths[0];
            const folderName = 'Sync 2upra';
            const downloadDir = path.join(baseDir, folderName);

            try {
                if (!fs.existsSync(downloadDir)) {
                    fs.mkdirSync(downloadDir, {recursive: true});
                }

                const files = fs.readdirSync(downloadDir);
                if (files.length > 0) {
                    let counter = 1;
                    let newDownloadDir = downloadDir;
                    while (fs.existsSync(newDownloadDir) && fs.readdirSync(newDownloadDir).length > 0) {
                        newDownloadDir = path.join(baseDir, `${folderName} (${counter})`);
                        counter++;
                    }
                    fs.mkdirSync(newDownloadDir, {recursive: true});
                    config.downloadDir = newDownloadDir;
                } else {
                    config.downloadDir = downloadDir;
                }

                fs.writeFileSync(configFilePath, JSON.stringify(config));
                customWindow.close();
                return config.downloadDir;
            } catch (error) {
                console.error('Error al crear directorio o guardar config:', error);
                // Mostrar mensaje de error con los mismos estilos
                const errorWindow = new BrowserWindow({
                    width: 400,
                    height: 200,
                    backgroundColor: '#070707',
                    frame: false,
                    transparent: true
                });

                const errorHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>${customCSS}</style>
                    </head>
                    <body>
                        <div class="dialog">
                            <h2>Error</h2>
                            <p>Hubo un error al crear el directorio de descargas.</p>
                            <button onclick="window.close()">Aceptar</button>
                        </div>
                    </body>
                    </html>
                `;

                errorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
            }
        }
    });

    ipcMain.once('cancel-selection', () => {
        customWindow.close();
        return null;
    });

    return new Promise(resolve => {
        customWindow.on('closed', () => {
            resolve(config.downloadDir || null);
        });
    });
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

/*
Error occurred in handler for 'get-sync-history': TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received undefined
    at Object.dirname (node:path:722:5)
    at C:\Users\1u\Documents\Sync 2upra\main.js:353:47
    at Array.map (<anonymous>)
    at C:\Users\1u\Documents\Sync 2upra\main.js:350:20
    at async WebContents.<anonymous> (node:electron/js2c/browser_init:2:86542) {
  code: 'ERR_INVALID_ARG_TYPE'
}
*/

ipcMain.handle('get-sync-history', async () => {
    //console.log('get-sync-history: Iniciando la obtención del historial de sincronización.');
    try {
        const historial = await getSyncHistory();
        //console.log('get-sync-history: Historial de sincronización obtenido:', historial);
        const resultado = historial
            .map(evento => {
                //console.log('get-sync-history: Procesando evento:', evento);
                const {timestamp, eventType, userId, audio, image} = evento;

                let rutaArchivo = null;
                if (audio) rutaArchivo = audio;
                if (image) rutaArchivo = image;

                if (!rutaArchivo) {
                    //console.warn('get-sync-history: El evento no tiene una ruta de archivo válida:', evento);
                    return null;
                }
                const nombreCarpeta = path.basename(path.dirname(rutaArchivo));
                const nombreArchivo = path.basename(rutaArchivo);
                //console.log('get-sync-history: Detalles del archivo procesado:', { rutaArchivo, nombreCarpeta, nombreArchivo });

                const detalles = {
                    rutaArchivo,
                    nombreCarpeta,
                    nombreArchivo,
                    userId,
                    audio,
                    image
                };
                return {
                    timestamp,
                    eventoTipo: eventType,
                    detalles
                };
            })
            .filter(item => {
                if (item === null) {
                    //console.log('get-sync-history: Filtrando evento nulo.');
                }
                return item !== null;
            });
        //console.log('get-sync-history: Resultado del procesamiento:', resultado);
        return resultado;
    } catch (error) {
        //console.error('get-sync-history: Error al obtener o procesar el historial de sincronización:', error);
        return [];
    }
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

ipcMain.on('auth-token', (event, token) => {
    console.log('Token recibido desde main:', token);
    verifyToken(token)
        .then(({userId: newUserId, newToken}) => {
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
                .then(({userId: newUserId, newToken}) => {
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
            const data = await verifyToken(authToken);
            if (data?.userId) {
                ipcMain.send('auth-token-reply', authToken);
            } else {
                handleInvalidToken();
            }
        } else {
            console.log('No hay authToken en storage');
            handleInvalidToken();
        }
    } catch (error) {
        console.error('Error en fetchData:', error);
        handleInvalidToken();
    }
});

ipcMain.handle('set-user-data', async (event, newUserId, newDownloadDir) => {
    console.log('Nuevo userId recibido:', newUserId);
    console.log('Nuevo downloadDir recibido:', newDownloadDir);
    userId = newUserId;
    downloadDir = newDownloadDir;
    if (userId && downloadDir) {
        startSyncing(userId, downloadDir);
    }
});
