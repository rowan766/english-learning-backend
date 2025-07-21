// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'english-learning-api',
      script: 'dist/main.js',
      cwd: '/home/zhanghuan/english-learning-app',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 8002,
        AWS_REGION: 'us-east-1',
      },
      error_file: '/home/zhanghuan/logs/english-learning-error.log',
      out_file: '/home/zhanghuan/logs/english-learning-out.log',
      log_file: '/home/zhanghuan/logs/english-learning-combined.log',
      time: true,
      max_memory_restart: '500M',
    }
  ]
};