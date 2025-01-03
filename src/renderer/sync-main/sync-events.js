/*
@param {String} data - La data recibida del proceso principal
@return {void} - No devuelve nada, solo escucha los eventos y los maneja.
*/
function registrarListenersEventos() {
    window.electronAPI.onAppEvent(data => {
        console.log('Evento desde el proceso principal:', data);
    });

    window.electronAPI.on('sync-file-downloaded', filePath => {
        console.log(`Archivo descargado: ${filePath}`);
        loadAndDisplaySyncHistory();
    });

    window.electronAPI.on('sync-completed', () => {
        console.log('Sincronización completada.');
        loadAndDisplaySyncHistory();
    });

    window.electronAPI.on('sync-error', error => {
        console.error('Error de sincronización:', error);
        mostrarErrorSincronizacion();
    });
}