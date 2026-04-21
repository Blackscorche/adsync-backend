const { Expo } = require('expo-server-sdk');
const pool = require('../config/database');

const expo = new Expo();

async function sendPushNotification(userId, { title, body, data = {} }) {
  try {
    const result = await pool.query(
      'SELECT push_token FROM users WHERE id = $1 AND push_token IS NOT NULL',
      [userId]
    );
    if (result.rows.length === 0) return;

    const token = result.rows[0].push_token;
    if (!Expo.isExpoPushToken(token)) return;

    const messages = [{
      to: token,
      sound: 'default',
      title,
      body,
      data,
    }];

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (err) {
    console.error('Push notification error:', err.message);
  }
}

async function sendPushToMany(userIds, payload) {
  await Promise.allSettled(userIds.map(id => sendPushNotification(id, payload)));
}

module.exports = { sendPushNotification, sendPushToMany };
