const path = require('path');

const root = __dirname;

module.exports = {
  apps: [{
    name: 'play-gloucester-room-one-panel',
    script: path.join(root, 'server.js'),
    cwd: root,
    interpreter: 'node',
    watch: false,
    autorestart: true,
    restart_delay: 2000,
    max_restarts: 50,
    min_uptime: 5000,
    exp_backoff_restart_delay: 100,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
