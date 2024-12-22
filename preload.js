//PRELOAD.JS

// Importa módulos de Electron para comunicación entre procesos.
const { contextBridge, ipcRenderer } = require('electron');

// Expone una API 'electronAPI' al proceso de renderizado.
contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, data) => ipcRenderer.send(channel, data), // Envía mensajes síncronos al proceso principal.
    invoke: (channel, data) => ipcRenderer.invoke(channel, data), // Envía mensajes y espera una respuesta (asíncrono).
    on: (channel, listener) => { 
        // Escucha mensajes del proceso principal.
        ipcRenderer.on(channel, (_, ...args) => listener(...args)); // El primer argumento de 'on' es el evento, se ignora con '_'.
    },
    onAppEvent: (listener) => ipcRenderer.on('app-event', (_, data) => listener(data)) // Escucha un evento específico 'app-event'.
});

// Expone una API 'consoleAPI' para usar la consola del proceso principal.
contextBridge.exposeInMainWorld('consoleAPI', {
    log: (...args) => ipcRenderer.send('console-log', ...args) // Envía mensajes 'console-log' al proceso principal para ser mostrados.
});

// Expone una API 'api' para interactuar con datos de la aplicación.
contextBridge.exposeInMainWorld('api', {
    getUserProfile: async receptorId => {
        // Obtiene el perfil de usuario.
        try {
            return await ipcRenderer.invoke('fetch-user-profile', receptorId); // Invoca 'fetch-user-profile' en el proceso principal.
        } catch (error) {
            console.error('Error fetching user profile:', error); // Maneja errores de la petición.
            return null; // Retorna null en caso de error.
        }
    }
});

// Expone una API 'electron' para funciones específicas de Electron.
contextBridge.exposeInMainWorld('electron', {
    getSyncHistory: () => ipcRenderer.invoke('get-sync-history'), // Obtiene el historial de sincronización.
    openFolder: filePath => ipcRenderer.invoke('open-folder', filePath) // Abre una carpeta en el explorador de archivos.
});