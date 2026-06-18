/// <reference types="vite/client" />

// Extend the NodeJS namespace with our environment variables
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}
	interface ImportMetaEnv {
		TELNYX_API_KEY: string;
		TELNYX_PHONE_NUMBER: string;
		TELNYX_CONNECTION_ID: string;
		TELNYX_MESSAGING_PROFILE_ID: string;
		/** A2P backend base URL (e.g. http://localhost:5200). When set, voice/SMS webhooks are forwarded here. */
		AI_BASE_URL?: string;
		/** A2P email service base URL (e.g. http://localhost:5100). Defaults to AI_BASE_URL if not set. */
		AI_BASE_URL_EMAIL?: string;
		/** A2P PostgreSQL read-only (comm_events, contacts). When set, communication log can load from here (if no API URL). */
		A2P_DATABASE_URL?: string;
		/** Optional: full URL to A2P comm-log API (e.g. http://host:5100/api/comm-events). When set, comm log is fetched from API instead of DB. */
		A2P_COMMLOG_API_URL?: string;
		GROQ_API_KEY: string;
		OPEN_AI_KEY: string;
		POCKETBASE_URL: string;
		NODE_ENV: string;
		PUBLIC_BASE_URL: string;
		PUBLIC_ENV: string;
		/** Base64 or raw JSON; optional; used for FCM push (see FIREBASE_SERVICE_ACCOUNT_JSON in .env.example). */
		FIREBASE_SERVICE_ACCOUNT_JSON?: string;
	}
}
