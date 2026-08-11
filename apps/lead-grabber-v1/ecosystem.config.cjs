module.exports = {
	apps: [
		{
			name: 'lead-grabber-v1',
			script: 'pnpm',
			args: 'run dev',
			instances: 1,
			exec_mode: 'fork',
			env: {
				NODE_ENV: 'development',
				PORT: 3005,
				HOST: '0.0.0.0'
			},
			error_file: './logs/pm2-error.log',
			out_file: './logs/pm2-out.log',
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			merge_logs: true,
			autorestart: true,
			max_restarts: 10,
			min_uptime: '10s',
			watch: false
		},
		{
			name: 'sweep-worker',
			script: './worker-sweep.js',
			instances: 1,
			exec_mode: 'fork',
			error_file: './logs/sweep-error.log',
			out_file: './logs/sweep-out.log',
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
			merge_logs: true,
			autorestart: true
		}
	]
};
