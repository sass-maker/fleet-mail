// Modified for Domain Inbox, 2026-10-27.
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [
		cloudflare({
			remoteBindings: false,
			configPath: process.env.INBOX_CONFIG_PATH,
			viteEnvironment: { name: "ssr" },
		}),
		tailwindcss(),
		reactRouter(),
		tsconfigPaths(),
	],
});
