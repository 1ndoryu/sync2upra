const {getSyncHistory, openFolder} = window.electron;
let currentHistoryItems = new Set();

async function inicializarAplicacion() {
    const userId = await window.electronAPI.invoke('get-user-id');
    const downloadDir = await window.electronAPI.invoke('get-download-dir');
    if (!userId) return console.error('Error: No se encontró un ID de usuario válido');
    if (downloadDir) {
        window.electronAPI.send('start-sync', {userId, downloadDir});
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
    document.getElementById('logout-button')?.addEventListener('click', async () => {
        await window.electronAPI.send('logout');
    });
    document.getElementById('cambiarCarpeta')?.addEventListener('click', async () => {
        await window.electronAPI.send('cambiarCarpeta');
    });
    document.getElementById('reiniciar')?.addEventListener('click', async () => {
        await window.electronAPI.send('reiniciar');
    });
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

async function fetchUserProfile(receptorId) {
    try {
        const userProfile = await window.api.getUserProfile(receptorId);
        if (userProfile) {
            const profileImage = document.getElementById('user-profile-image');
            const profileName = document.getElementById('user-profile-name');
            if (profileImage && profileName) {
                profileImage.src = userProfile.imagenPerfil || 'ruta_por_defecto.jpg';
                profileName.textContent = userProfile.nombreUsuario || 'Usuario Desconocido';
            } else {
                console.error('Error: Elementos del perfil de usuario no encontrados en el DOM.');
            }
        } else {
            console.error('Error: No se pudo obtener el perfil de usuario.');
        }
    } catch (error) {
        console.error('Error al obtener el perfil de usuario:', error);
    }
}

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

function mostrarErrorSincronizacion() {
    const audioList = document.getElementById('audio-list');
    audioList.innerHTML = '';
    const errorMessage = document.createElement('p');
    errorMessage.textContent = 'Error al sincronizar. Por favor, inténtalo de nuevo.';
    errorMessage.style.color = 'red';
    audioList.appendChild(errorMessage);
}

function loadAndDisplaySyncHistory() {
    getSyncHistory()
        .then(history => {
            const audioList = document.getElementById('audio-list');

            // Solo limpiar la lista si no está vacía y no hay historial
            if (!history || history.length === 0) {
                if (audioList.innerHTML === '') {
                    audioList.innerHTML = '';
                    const emptyMessage = document.createElement('p');
                    emptyMessage.textContent = 'No hay elementos en el historial de sincronización.';
                    audioList.appendChild(emptyMessage);
                    return;
                }
            } else if (history && history.length > 0 && audioList.firstChild && audioList.firstChild.tagName === 'P' && audioList.firstChild.textContent === 'No hay elementos en el historial de sincronización.') {
                audioList.innerHTML = '';
            }

            if (history && history.length > 0) {
                // Ordenar el historial por fecha (del más reciente al más antiguo)
                history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                history.forEach(event => {
                    const {timestamp, eventType, details} = event;
                    const {folderName, fileName} = details;

                    // Crear un identificador único para cada evento
                    const itemId = `${fileName}-${timestamp}`;

                    // Si ya hemos renderizado este item, lo ignoramos
                    if (currentHistoryItems.has(itemId)) {
                        return;
                    }

                    // Guardar el nuevo item en el conjunto para evitar duplicados en el futuro
                    currentHistoryItems.add(itemId);

                    const li = document.createElement('li');

                    // Crear el contenedor principal
                    const containerDiv = document.createElement('div');
                    containerDiv.className = 'item-container';

                    // Crear el primer ícono SVG
                    const iconDiv = document.createElement('div');
                    iconDiv.className = 'icon-container';
                    const svgIcon1 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svgIcon1.setAttribute('data-testid', 'geist-icon');
                    svgIcon1.setAttribute('height', '16');
                    svgIcon1.setAttribute('width', '16');
                    svgIcon1.setAttribute('viewBox', '0 0 22 22');
                    svgIcon1.setAttribute('stroke-linejoin', 'round');
                    svgIcon1.setAttribute('style', 'color: white');
                    svgIcon1.innerHTML = `<path class="cls-1" d="M15.68,4.85c0-.14-.07-.31-.17-.41-1.41-1.43-2.83-2.85-4.26-4.26-.1-.1-.27-.17-.41-.17C7.8,0,4.75,0,1.71,0,.78,0,0,.78,0,1.71,0,7.54,0,13.37,0,19.21c0,.73,.49,1.38,1.19,1.62,.08,.03,.16,.06,.24,.09H14.26c.25-.12,.53-.21,.75-.37,.45-.33,.67-.79,.67-1.35,0-4.78,0-9.56,0-14.34Zm-4.15,4.69c-1.1,0-2.19,0-3.29,0h-.3v.29c0,1.5,0,3,0,4.5,0,1.26-.8,2.29-1.99,2.62-1.44,.4-2.96-.5-3.29-1.94-.35-1.51,.6-2.98,2.1-3.26,.76-.14,1.44,.04,2.12,.5,0-.15,0-.23,0-.32,0-1.64,0-3.28,0-4.92,0-.48,.19-.67,.67-.67,1.33,0,2.66,0,3.99,0,.49,0,.68,.19,.68,.69,0,.61,0,1.22,0,1.83,0,.52-.18,.7-.69,.7Zm.53-5.21c-.33,0-.68-.3-.69-.62-.04-.72-.01-1.43-.01-2.13,.91,.91,1.83,1.84,2.76,2.76-.68,0-1.37,.01-2.05,0Z"/></svg>`;
                    iconDiv.appendChild(svgIcon1);

                    // Crear el contenedor del texto
                    const textDiv = document.createElement('div');
                    textDiv.className = 'text-container';

                    // Crear el párrafo del nombre del archivo
                    const fileNamePara = document.createElement('p');
                    fileNamePara.textContent = `${fileName}`;
                    fileNamePara.className = 'file-name';

                    // Crear el párrafo del mensaje de estado
                    const statusPara = document.createElement('p');
                    let statusMessage;
                    if (eventType === 'download') {
                        const date = new Date(timestamp);
                        const timeAgoString = timeAgo(date);
                        statusMessage = `Descargado ${timeAgoString}`;
                    } else if (eventType === 'delete') {
                        const date = new Date(timestamp);
                        const timeAgoString = timeAgo(date);
                        statusMessage = `Eliminado ${timeAgoString}`;
                    }
                    statusPara.textContent = statusMessage;
                    statusPara.className = 'status-message';

                    // Guardar el timestamp como un atributo data para su comparación en insertInOrder
                    statusPara.dataset.timestamp = timestamp;

                    // Añadir los párrafos al contenedor de texto
                    textDiv.appendChild(fileNamePara);
                    textDiv.appendChild(statusPara);

                    // Crear el segundo ícono SVG
                    const secondIconDiv = document.createElement('div');
                    secondIconDiv.className = 'second-icon-container';
                    const svgIcon2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svgIcon2.setAttribute('data-testid', 'geist-icon');
                    svgIcon2.setAttribute('height', '16');
                    svgIcon2.setAttribute('width', '16');
                    svgIcon2.setAttribute('viewBox', '0 0 16 16');
                    svgIcon2.setAttribute('stroke-linejoin', 'round');
                    svgIcon2.setAttribute('style', 'color: currentcolor');
                    svgIcon2.innerHTML = `<path fill-rule="evenodd" clip-rule="evenodd" d="M15.5607 3.99999L15.0303 4.53032L6.23744 13.3232C5.55403 14.0066 4.44599 14.0066 3.76257 13.3232L4.2929 12.7929L3.76257 13.3232L0.969676 10.5303L0.439346 9.99999L1.50001 8.93933L2.03034 9.46966L4.82323 12.2626C4.92086 12.3602 5.07915 12.3602 5.17678 12.2626L13.9697 3.46966L14.5 2.93933L15.5607 3.99999Z" fill="currentColor"></path>`;
                    secondIconDiv.appendChild(svgIcon2);

                    // Añadir todo al contenedor principal
                    containerDiv.appendChild(iconDiv);
                    containerDiv.appendChild(textDiv);
                    containerDiv.appendChild(secondIconDiv);

                    // Añadir el contenedor principal al li
                    li.appendChild(containerDiv);

                    // Añadir un event listener para abrir la carpeta
                    li.addEventListener('click', () => {
                        if (details.filePath) {
                            openFolder(details.filePath);
                        } else {
                            console.error('File path is not defined.');
                        }
                    });
                    insertInOrder(audioList, li, timestamp);
                });
            }
        })
        .catch(error => {
            console.error('Error fetching sync history:', error);
        });
}
