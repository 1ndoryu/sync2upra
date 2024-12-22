/*
@param {Element} list - La lista donde se insertarán los elementos
@param {Element} newItem - El elemento a insertar
@param {string} newTimestamp - La fecha y hora en formato ISO 8601
@return {void} - No devuelve nada, solo crea los elementos para renderizarlos en el DOM
*/
function insertInOrder(list, newItem, newTimestamp) {
    const newDate = new Date(newTimestamp);
    for (let i = 0; i < list.children.length; i++) {
        const child = list.children[i];
        const existingTimestamp = child.querySelector('.status-message').dataset.timestamp;
        const existingDate = new Date(existingTimestamp);
        if (newDate > existingDate) {
            list.insertBefore(newItem, child);
            return;
        }
    }
    list.appendChild(newItem);
}


document.addEventListener('DOMContentLoaded', () => {
    loadAndDisplaySyncHistory(); 
});


/*
@param {string} timestamp - La fecha y hora en formato ISO 8601
@return {string} - El tiempo transcurrido en el pasado
*/
function calculateTimePassed (isoString) { 
    const givenDate = new Date(isoString); 
    const currentDate = new Date(); 
    
    const differenceInMilliseconds = currentDate.getTime() - givenDate.getTime(); 

    const differenceInDays = Math.floor(differenceInMilliseconds / (1000 * 60 * 60 * 24)); 
    const differenceInHours = Math.floor(differenceInMilliseconds / (1000 * 60 * 60)); 
    const differenceInMinutes = Math.floor(differenceInMilliseconds / (1000 * 60));

    if (differenceInDays > 365) {
        const calculateYears = differenceInDays > 1 ? 'años' : 'año';
        return { s: `hace ${differenceInDays / 365} ${calculateYears}` };
    }

    if (differenceInDays > 30) {
        const calculateMonths = differenceInDays > 60 ? 'meses' : 'mes';
        return { s: `hace ${differenceInDays / 30} ${calculateMonths}` };
    }

    if (differenceInDays > 7) {
        const calculateWeeks = differenceInDays > 14 ? 'semanas' : 'semana';
        return { s: `hace ${differenceInDays / 7} ${calculateWeeks}` };
    }

    if (differenceInDays > 0) {
        const calculateDays = differenceInDays > 1 ? 'días' : 'día';
        return { s: `hace ${differenceInDays} ${calculateDays}` };
    }

    if (differenceInHours > 0) {
        const calculateHours = differenceInHours > 1 ? 'horas' : 'hora';
        return { s: `hace ${differenceInHours} ${calculateHours}` };
    } 

    if (differenceInMinutes > 0) {
        const calculateMinutes = differenceInMinutes > 1 ? 'minutos' : 'minuto';
        return { s: `hace ${differenceInMinutes} ${calculateMinutes}` };
    }
}

/*
@return {void} - No devuelve nada, solo muestra un mensaje de error
*/
function mostrarErrorSincronizacion() {
    const audioList = document.getElementById('audio-list');
    audioList.innerHTML = '';
    const errorMessage = document.createElement('p');
    errorMessage.textContent = 'Error al sincronizar. Por favor, inténtalo de nuevo.';
    errorMessage.style.color = 'red';
    audioList.appendChild(errorMessage);
}
