/* 
 Eventos del DOM
*/

document.getElementById('logout-button')?.addEventListener('click', async () => {
    await window.electronAPI.send('logout');
});

/* document.getElementById('cambiarCarpeta')?.addEventListener('click', async () => {
    await window.electronAPI.send('cambiarCarpeta');
});*/

document.getElementById('reiniciar')?.addEventListener('click', async () => {
    await window.electronAPI.send('reiniciar');
});

document.addEventListener('sync-single-audio', async event => {
    const userId = await window.electronAPI.invoke('get-user-id');
    const downloadDir = await window.electronAPI.invoke('get-download-dir');
    if (userId && downloadDir) {
        syncSingleAudio(userId, event.detail.postId, downloadDir);
    } else {
        console.error('Error: No se pudo obtener el ID de usuario o el directorio de descarga para sincronizar el audio individual');
    }
});

document.getElementById('sync-button')?.addEventListener('click', async () => {
    const syncModal = document.getElementById('sync-modal');
    const button = document.getElementById('sync-button');
    syncModal.classList.add('active');
    button.classList.add('loading-sync');
    
    
    setTimeout(() => {
        syncModal.classList.remove('active');
        button.classList.remove('loading-sync');
    }, 1200);
});


/* 
 Eventos del DOM
*/