module.exports = {
  apps: [{
    name: 'ivaa-backend',
    script: './src/index.js',
    instances: 1,
    exec_mode: 'fork',

    // Increased for 4GB droplet - allows large file processing
    node_args: '--max-old-space-size=3072',

    // Auto-restart if memory exceeds 3GB
    max_memory_restart: '3G',

    env: {
      NODE_ENV: 'production',
      PORT: 7000
    },

    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,

    // Process management
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',

    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
};