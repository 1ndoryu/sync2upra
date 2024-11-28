/*
const axios = require('axios');
const API_BASE = 'https://2upra.com/wp-json';

module.exports = {
  fetchCollectedAudios: async (userId) => {
    try {
      const response = await axios.get(`${API_BASE}/1/v1/collections?user=${userId}`, {
        withCredentials: true 
      });
      return response.data;
    } catch (error) {
      console.error("Error en fetchCollectedAudios:", error);
      throw error; 
    }
  }
};
*/