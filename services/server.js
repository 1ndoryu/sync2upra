const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const WEBHOOK_PORT = 3000; // Cambia el puerto si es necesario

// Endpoint para recibir notificaciones del webhook
app.post('/webhook', (req, res) => {
    const { userId, action } = req.body;

    console.log(`Webhook recibido: Acción: ${action}, User ID: ${userId}`);

    // Aquí activamos el proceso de sincronización
    if (action === 'descarga' || action === 'samples_guardados') {
        const downloadDir = store.get('downloadDir'); // Asegúrate de tener esta variable configurada
        startSyncing(userId, downloadDir);
    }

    // Responder al webhook
    res.status(200).json({ success: true });
});

// Inicia el servidor
app.listen(WEBHOOK_PORT, () => {
    console.log(`Servidor de webhook escuchando en el puerto ${WEBHOOK_PORT}`);
});