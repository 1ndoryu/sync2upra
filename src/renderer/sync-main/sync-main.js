/* 
@param {string} - Recibe el ID del receptor.
@return {void} - No devuelve nada, solo carga y muestra el perfil del usuario.
*/
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

/*
@param {void} - No recibe parámetros.
@return {void} - No devuelve nada, solo actualiza el texto de los elementos "Sincronizado" y "Eliminado" y calcular el tiempo transcurrido.
*/
function updateTimeAgoElements() {
    const statusMessages = document.querySelectorAll('.status-message');
    console.log(statusMessages)

    statusMessages.forEach(statusElement => {
        const timestamp = statusElement.dataset.timestamp;

        if (timestamp) {
            const originalText = statusElement.textContent;

            if (originalText.includes('Sincronizado')) {
                statusElement.textContent = `Sincronizado ${calculateTimePassed(timestamp).s}`;
            } else if (originalText.includes('Eliminado')) {
                statusElement.textContent = `Eliminado ${calculateTimePassed(timestamp).s}`;
            }
        }
    });
}

setInterval(updateTimeAgoElements, 60000);

/*
@param {void} - No recibe parámetros.
@retur {void} - No devuelve nada, solo carga y muestra el historial de sincronización.
*/
function loadAndDisplaySyncHistory() {

    getSyncHistory()
        .then(history => {

            const audioList = document.getElementById('audio-list');
            if (!audioList) {
                console.error('Elemento con ID "audio-list" no encontrado en el DOM.');
                return;
            }

            // Si no hay historial o está vacío
            if (history.length === 0) {
                if (audioList.innerHTML === '') {
                    audioList.innerHTML = '';
                    const emptyMessage = document.createElement('p');
                    emptyMessage.textContent = 'Aún no hay elementos en el historial de sincronización :)';
                    audioList.appendChild(emptyMessage);
                }
                return;
            } else if (history && history.length > 0 && audioList.firstChild && audioList.firstChild.tagName === 'P' && audioList.firstChild.textContent === 'Aún no hay elementos en el historial de sincronización :)') {
                audioList.innerHTML = '';
            }

            // Ordenar el historial por fecha (descendente)
            if (history && history.length > 0) {
                history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                history.forEach(event => {
                    console.log('Procesando evento:', event);

                    // Validar que el objeto tenga los campos necesarios
                    const { timestamp, eventoTipo, detalles } = event;
                    console.log(`Revisando que mierda hace el timestamp: ${timestamp}`);

                    if (!timestamp || !eventoTipo) {
                        console.warn('Evento ignorado porque no tiene timestamp o eventoTipo:', event);
                        return; // Ignorar eventos inválidos
                    }

                    if (!detalles || !detalles.audio) {
                        console.warn('Evento ignorado porque no contiene detalles o audio:', event);
                        return; // Ignorar eventos sin detalles válidos
                    }

                    const { audio, image } = detalles;
                    const itemId = `${audio}-${timestamp}`;

                    if (currentHistoryItems.has(itemId)) {
                        return;
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
                        const img = document.createElement('img');
                        img.src = image;
                        img.alt = 'Imagen asociada';
                        // Clase para agregar los estilos en la imagen
                        // Usando elementos del DOM
                        img.className = 'thumbnail';
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
                        statusMessage = `Sincronizado ${calculateTimePassed(timestamp).s}`;
                    } else if (eventoTipo === 'delete') {
                        statusMessage = `Eliminado ${calculateTimePassed(timestamp).s}`;
                    } else {
                        return
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
                            openFolder(audio);
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