const { getSyncHistory, openFolder } = window.electron;
let currentHistoryItems = new Set();

async function inicializarAplicacion() {
    const userId = await window.electronAPI.invoke('get-user-id');
    const downloadDir = await window.electronAPI.invoke('get-download-dir');
    if (!userId) return console.error('Error: No se encontró un ID de usuario válido');
    if (downloadDir) {
        window.electronAPI.send('start-sync', { userId, downloadDir });
    } else {
        console.error('Error: No se pudo obtener el directorio de descarga');
    }
    createSubmenu('.opciones', 'opciones', 'abajo');
}

document.addEventListener('DOMContentLoaded', async () => {
    inicializarAplicacion();
    const userId = await window.electronAPI.invoke('get-user-id');
    fetchUserProfile(userId);
    registrarListenersEventos();

    async function intentarCargarHistorial(intentosRestantes) {
        try {
            await loadAndDisplaySyncHistory();
        } catch (error) {
            console.error(`Error al cargar el historial de sincronización (intentos restantes: ${intentosRestantes}):`, error);
            if (intentosRestantes > 0) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                await intentarCargarHistorial(intentosRestantes - 1);
            } else {
                console.error('Se superó el número máximo de intentos para cargar el historial de sincronización.');
            }
        }
    }

    await intentarCargarHistorial(3);
});