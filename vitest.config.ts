import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		alias: {
			'@earendil-works/pi-tui': path.resolve(__dirname, 'extensions/pi-shmitline/test/tui-mock.ts'),
		},
		coverage: {
			provider: 'v8',
			include: ['extensions/pi-headroom/index.ts', 'extensions/pi-headroom/src/**/*.ts'],
			reporter: ['text', 'json-summary'],
			reportsDirectory: 'coverage/pi-headroom',
		},
		type: 'module',
	},
});
