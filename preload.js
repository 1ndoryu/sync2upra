//PRELOAD.JS
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, data) => ipcRenderer.send(channel, data),
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    on: (channel, listener) => {
        ipcRenderer.on(channel, (_, ...args) => listener(...args));
    },
    onAppEvent: (listener) => ipcRenderer.on('app-event', (_, data) => listener(data)) 
});

contextBridge.exposeInMainWorld('consoleAPI', {
    log: (...args) => ipcRenderer.send('console-log', ...args)
});

contextBridge.exposeInMainWorld('api', {
    getUserProfile: async receptorId => {
        try {
            return await ipcRenderer.invoke('fetch-user-profile', receptorId);
        } catch (error) {
            console.error('Error fetching user profile:', error);
            return null;
        }
    }
});

contextBridge.exposeInMainWorld('electron', {
    getSyncHistory: () => ipcRenderer.invoke('get-sync-history'),
    openFolder: filePath => ipcRenderer.invoke('open-folder', filePath)
});

