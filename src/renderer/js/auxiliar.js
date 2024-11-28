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

function timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) {
        return 'hace menos de un minuto';
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        return `hace ${minutes} minuto${minutes !== 1 ? 's' : ''}`;
    } else if (seconds < 86400) {
        const hours = Math.floor(seconds / 3600);
        return `hace ${hours} hora${hours !== 1 ? 's' : ''}`;
    } else {
        const days = Math.floor(seconds / 86400);
        return `hace ${days} día${days !== 1 ? 's' : ''}`;
    }
}