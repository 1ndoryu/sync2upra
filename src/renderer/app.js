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

    async function intentarCargarHistorial(intentosRestantes) {
        try {
            await loadAndDisplaySyncHistory();
        } catch (error) {
            console.error(`Error al cargar el historial de sincronización (intentos restantes: ${intentosRestantes}):`, error);
            if (intentosRestantes > 0) {
                await new Promise(resolve => setTimeout(resolve, 3000)); // Esperar 3 segundos
                await intentarCargarHistorial(intentosRestantes - 1); // Reintentar
            } else {
                console.error('Se superó el número máximo de intentos para cargar el historial de sincronización.');
                // Aquí puedes mostrar un mensaje de error al usuario o realizar otra acción.
            }
        }
    }

    await intentarCargarHistorial(3); // Iniciar con 3 intentos

    document.getElementById('logout-button')?.addEventListener('click', async () => {
        await window.electronAPI.send('logout');
    });
    /* document.getElementById('cambiarCarpeta')?.addEventListener('click', async () => {
        await window.electronAPI.send('cambiarCarpeta');
    });*/
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

// Función para actualizar el tiempo transcurrido dinámicamente
function updateTimeAgoElements() {
    const currentTime = Date.now();
    const statusMessages = document.querySelectorAll('.status-message');

    statusMessages.forEach(statusElement => {
        const timestamp = statusElement.dataset.timestamp;

        if (timestamp) {
            const timeAgoString = timeAgo(new Date(parseInt(timestamp, 10)));
            const originalText = statusElement.textContent;

            // Detecta si es un mensaje de sincronización o eliminación
            if (originalText.includes('Sincronizado')) {
                statusElement.textContent = `Sincronizado ${timeAgoString}`;
            } else if (originalText.includes('Eliminado')) {
                statusElement.textContent = `Eliminado ${timeAgoString}`;
            }
        }
    });
}

// Llama a updateTimeAgoElements cada minuto
setInterval(updateTimeAgoElements, 60000);

// Función principal de carga e inicialización del historial
function loadAndDisplaySyncHistory() {
    console.log('Iniciando loadAndDisplaySyncHistory...');

    getSyncHistory()
        .then(history => {
            console.log('Historial recibido:', history); // Verificar si se recibe el historial correctamente

            const audioList = document.getElementById('audio-list');
            if (!audioList) {
                console.error('Elemento con ID "audio-list" no encontrado en el DOM.');
                return;
            }

            // Si no hay historial o está vacío
            if (!history || history.length === 0) {
                console.log('El historial está vacío.');
                if (audioList.innerHTML === '') {
                    audioList.innerHTML = '';
                    const emptyMessage = document.createElement('p');
                    emptyMessage.textContent = 'Aún no hay elementos en el historial de sincronización :)';
                    audioList.appendChild(emptyMessage);
                }
                return;
            } else if (history && history.length > 0 && audioList.firstChild && audioList.firstChild.tagName === 'P' && audioList.firstChild.textContent === 'Aún no hay elementos en el historial de sincronización :)') {
                console.log('Eliminando mensaje vacío del historial.');
                audioList.innerHTML = '';
            }

            // Ordenar el historial por fecha (descendente)
            if (history && history.length > 0) {
                console.log('Ordenando el historial por timestamp.');
                history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                history.forEach(event => {
                    console.log('Procesando evento:', event);

                    // Validar que el objeto tenga los campos necesarios
                    const {timestamp, eventoTipo, detalles} = event; // Cambiado `eventType` por `eventoTipo`

                    if (!timestamp || !eventoTipo) {
                        console.warn('Evento ignorado porque no tiene timestamp o eventoTipo:', event);
                        return; // Ignorar eventos inválidos
                    }

                    if (!detalles || !detalles.audio) {
                        console.warn('Evento ignorado porque no contiene detalles o audio:', event);
                        return; // Ignorar eventos sin detalles válidos
                    }

                    const {audio, image} = detalles;
                    const itemId = `${audio}-${timestamp}`;

                    if (currentHistoryItems.has(itemId)) {
                        console.log(`Elemento duplicado ignorado: ${itemId}`);
                        return; // Evitar duplicados
                    }

                    currentHistoryItems.add(itemId);

                    // Crear elementos del historial
                    const li = document.createElement('li');
                    const containerDiv = document.createElement('div');
                    containerDiv.className = 'item-container';

                    // Div para el ícono (imagen)
                    const iconDiv = document.createElement('div');
                    iconDiv.className = 'icon-container';

                    if (image) {
                        console.log('Agregando imagen al historial:', image);
                        const img = document.createElement('img');
                        img.src = image;
                        img.alt = 'Imagen asociada';
                        img.className = 'thumbnail'; // Clase para estilos CSS
                        iconDiv.appendChild(img);
                    } else {
                        console.log('No se encontró imagen para este evento.');
                    }

                    // Div para el texto (audio y estado)
                    const textDiv = document.createElement('div');
                    textDiv.className = 'text-container';

                    const fileNamePara = document.createElement('p');
                    fileNamePara.textContent = `${audio.split('\\').pop()}`; // Mostrar solo el nombre del archivo
                    fileNamePara.className = 'file-name';

                    const statusPara = document.createElement('p');
                    let statusMessage;

                    // Manejar los diferentes tipos de eventos
                    if (eventoTipo === 'download') {
                        const date = new Date(timestamp);
                        const timeAgoString = timeAgo(date);
                        statusMessage = `Sincronizado ${timeAgoString}`;
                    } else if (eventoTipo === 'delete') {
                        const date = new Date(timestamp);
                        const timeAgoString = timeAgo(date);
                        statusMessage = `Eliminado ${timeAgoString}`;
                    } else {
                        console.warn('Evento con tipo desconocido:', eventoTipo);
                        statusMessage = 'Evento desconocido';
                    }

                    statusPara.textContent = statusMessage;
                    statusPara.className = 'status-message';
                    statusPara.dataset.timestamp = timestamp;

                    // Añadir texto al contenedor de texto
                    textDiv.appendChild(fileNamePara);
                    textDiv.appendChild(statusPara);

                    // Añadir ambos contenedores al contenedor principal
                    containerDiv.appendChild(iconDiv);
                    containerDiv.appendChild(textDiv);

                    // Añadir evento click para abrir la carpeta
                    li.appendChild(containerDiv);
                    li.addEventListener('click', () => {
                        if (audio) {
                            console.log('Abriendo carpeta para el archivo:', audio);
                            openFolder(audio); // Abrir la carpeta del archivo de audio
                        } else {
                            console.error('Ruta del archivo no está definida.');
                        }
                    });

                    // Insertar el elemento en el DOM en orden de tiempo
                    insertInOrder(audioList, li, timestamp);
                });
            }
        })
        .catch(error => {
            console.error('Error al obtener el historial de sincronización:', error);
        });
}

/*
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
                             containerDiv.appendChild(secondIconDiv);

*/
