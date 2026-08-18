#!/usr/bin/env node
/**
 * Generates the OpenAPI JSDoc annotation files for sveltekit-openapi-generator:
 *
 *   src/lib/api/openapi-schemas.generated.js   (shared components)
 *   src/lib/api/openapi-paths.generated.js     (one @swagger block per route)
 *
 * The paths are derived by parsing each src/routes/api route file
 * (methods, body fields, query params, auth) plus hand-curated overrides
 * for the mobile-critical endpoints.
 *
 * Run:  node scripts/gen-openapi.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import yaml from '/Users/user/code/projects/a2p/node_modules/.pnpm/js-yaml@4.2.0/node_modules/js-yaml/index.js';

const APP_DIR = new URL('..', import.meta.url).pathname;
const API_DIR = join(APP_DIR, 'src', 'routes', 'api');
const OUT_DIR = join(APP_DIR, 'src', 'lib', 'api');

// ---------------------------------------------------------------------------
// 1. Scan route files
// ---------------------------------------------------------------------------

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.name === '+server.ts') out.push(full);
	}
	return out;
}

const files = walk(API_DIR);

function toOpenApiPath(file) {
	let p = relative(join(APP_DIR, 'src', 'routes'), file);
	p = p.replace(/\+server\.ts$/, '').replace(/\/+$/, '');
	p = '/' + p;
	// [id] -> {id}, [...rest] -> {rest}
	p = p.replace(/\[\.\.\.([^\]]+)\]/g, '{$1}').replace(/\[([^\]]+)\]/g, '{$1}');
	return p;
}

function extractMethods(source) {
	const re = /export\s+(?:const|async\s+function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
	const methods = [...source.matchAll(re)].map((m) => m[1]);
	if (!methods.length && /export\s+const\s+fallback\b/.test(source)) return ['ALL'];
	return methods;
}

function extractSummary(source) {
	const m = source.match(/\/\*\*\s*\n([\s\S]*?)\*\//);
	if (!m) return null;
	const lines = m[1]
		.split('\n')
		.map((l) => l.replace(/^\s*\*?\s?/, '').trim())
		.filter(Boolean);
	if (!lines.length) return null;
	const first = lines[0];
	return first.length > 160 ? first.slice(0, 157) + '...' : first;
}

function extractBodyFields(source) {
	const fields = new Set();
	// const { a, b, c = x } = await request.json();
	const re = /const\s*\{([^}]+)\}\s*=\s*(?:await\s+)?request\.json\(\)/g;
	for (const m of source.matchAll(re)) {
		for (const part of m[1].split(',')) {
			const name = part.trim().split(/[=:]/)[0].trim();
			if (name && !name.includes(' ')) fields.add(name);
		}
	}
	return [...fields];
}

function extractQueryParams(source) {
	const re = /searchParams\.get\(['"]([\w-]+)['"]\)/g;
	return [...new Set([...source.matchAll(re)].map((m) => m[1]))];
}

const WEBHOOKISH = /\/(webhook|call-webhook|webhook-backup|incoming-sms|incoming-call|inbound-email|facebook|test-webhook|track|upload)\//;
const PUBLIC = /\/api\/(auth|telnyx\/webhook|book|embed|invite|webhooks|track|upload|company\/wipe-data)/;

// ---------------------------------------------------------------------------
// 2. Hand-curated overrides for mobile-critical endpoints
// ---------------------------------------------------------------------------

const OVERRIDES = {};

function override(path, methods) {
	OVERRIDES[path] = { ...OVERRIDES[path], ...methods };
}

override('/api/auth/login', {
	post: {
		summary: 'Log in with email and password',
		tags: ['auth'],
		requestBody: {
			required: true,
			content: {
				'application/json': {
					schema: {
						type: 'object',
						required: ['email', 'password'],
						properties: {
							email: { type: 'string', format: 'email' },
							password: { type: 'string' }
						}
					}
				}
			}
		},
		responses: {
			200: {
				description: 'Authenticated. Returns the JWT used as `Authorization: Bearer <token>`.',
				content: {
					'application/json': { schema: { $ref: '#/components/schemas/UserTokenResponse' } }
				}
			},
			401: { description: 'Invalid email or password', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/auth/refresh', {
	post: {
		summary: 'Refresh the session token (requires valid existing token)',
		tags: ['auth'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: { description: 'New token + user', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserTokenResponse' } } } },
			401: { description: 'Unauthorized or token expired', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/auth/signup', {
	post: {
		summary: 'Create an account (email + name + password)',
		tags: ['auth'],
		requestBody: {
			required: true,
			content: {
				'application/json': {
					schema: {
						type: 'object',
						required: ['email', 'password', 'name'],
						properties: {
							email: { type: 'string', format: 'email' },
							password: { type: 'string', minLength: 8 },
							name: { type: 'string' }
						}
					}
				}
			}
		},
		responses: {
			200: { description: 'Account created (no company yet)', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserTokenResponse' } } } },
			400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/auth/otp/send', {
	post: {
		summary: 'Send a 5-digit verification code by email (intent: login | signup)',
		tags: ['auth'],
		requestBody: {
			required: true,
			content: {
				'application/json': {
					schema: {
						type: 'object',
						required: ['email'],
						properties: {
							email: { type: 'string', format: 'email' },
							intent: { type: 'string', enum: ['login', 'signup'], default: 'login' },
							name: { type: 'string', description: 'required when intent=signup' },
							password: { type: 'string', description: 'required when intent=signup' }
						}
					}
				}
			}
		},
		responses: {
			200: { description: 'Code sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
			404: { description: 'No account found with this email', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/auth/otp/verify', {
	post: {
		summary: 'Verify the 5-digit code and exchange it for a session token',
		tags: ['auth'],
		requestBody: {
			required: true,
			content: {
				'application/json': {
					schema: {
						type: 'object',
						required: ['email', 'code'],
						properties: {
							email: { type: 'string', format: 'email' },
							code: { type: 'string', description: '5-digit code' },
							intent: { type: 'string', enum: ['login', 'signup'], default: 'login' }
						}
					}
				}
			}
		},
		responses: {
			200: {
				description: 'Verified. Sets app_session cookie; token also returned.',
				content: { 'application/json': { schema: { $ref: '#/components/schemas/UserTokenResponse' } } }
			},
			400: { description: 'Invalid or expired code', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/auth/forgot-password', {
	post: {
		summary: 'Request a password reset code',
		tags: ['auth'],
		responses: {
			200: { description: 'Reset code sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } }
		}
	}
});

override('/api/auth/reset-password', {
	post: {
		summary: 'Reset the password with the emailed code',
		tags: ['auth'],
		responses: {
			200: { description: 'Password updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } }
		}
	}
});

override('/api/me', {
	get: {
		summary: 'Get the authenticated user profile (id, name, email, company, role)',
		tags: ['me'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: {
				description: 'Profile',
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								success: { type: 'boolean' },
								data: { $ref: '#/components/schemas/User' }
							}
						}
					}
				}
			},
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	},
	put: {
		summary: 'Update name, email or avatar of the authenticated user',
		tags: ['me'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		requestBody: {
			content: {
				'application/json': {
					schema: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							email: { type: 'string', format: 'email' },
							avatar: { type: 'string' }
						}
					}
				}
			}
		},
		responses: {
			200: { description: 'Updated profile', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/User' } } } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/sip/credentials', {
	get: {
		summary: 'Get Telnyx WebRTC connection config + short-lived token for the dialer',
		description:
			'Returns connectionId, callerIdName, callerIdNumber and a short-lived webrtcToken ' +
			'for the Telnyx WebRTC SDK. The dialer authenticates with this token, not the API key.',
		tags: ['telnyx', 'dialer'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: {
				description: 'WebRTC credentials',
				content: {
					'application/json': { schema: { $ref: '#/components/schemas/SipCredentials' } }
				}
			},
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/telnyx/dial', {
	post: {
		summary: 'Place an outbound call through Telnyx (server-side call control)',
		tags: ['telnyx', 'dialer'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		requestBody: {
			required: true,
			content: {
				'application/json': {
					schema: {
						type: 'object',
						required: ['to'],
						properties: {
							to: { type: 'string', description: 'Destination phone number' },
							from: { type: 'string', description: 'Caller ID override (defaults to company number)' },
							clientId: { type: 'string' },
							commId: { type: 'string' },
							leg: { type: 'string', default: 'outbound_dial' },
							priority: { type: 'string', default: 'normal' }
						}
					}
				}
			}
		},
		responses: {
			200: {
				description: 'Call initiated',
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								success: { type: 'boolean' },
								callId: { type: 'string', description: 'Telnyx call_control_id' },
								callLegId: { type: 'string' }
							}
						}
					}
				}
			},
			400: { description: 'Missing number / no company number assigned', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/telnyx/hangup', {
	post: {
		summary: 'Hang up a call by its Telnyx call_control_id',
		tags: ['telnyx', 'dialer'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		requestBody: {
			required: true,
			content: {
				'application/json': {
					schema: {
						type: 'object',
						required: ['callId'],
						properties: { callId: { type: 'string', description: 'Telnyx call_control_id returned by POST /api/telnyx/dial' } }
					}
				}
			}
		},
		responses: {
			200: { description: 'Hangup requested', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/telnyx/answer-call', {
	post: {
		summary: 'Answer an inbound call by its Telnyx call_control_id',
		tags: ['telnyx', 'dialer'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: { description: 'Call answered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/telnyx/log-webrtc-call', {
	post: {
		summary: 'Log a WebRTC dialer call into the call log / communication log',
		tags: ['telnyx', 'dialer'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: { description: 'Call logged', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/telnyx/numbers/list', {
	get: {
		summary: 'List Telnyx numbers owned by the account',
		tags: ['telnyx', 'numbers'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: { description: 'Number list', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/sms/send', {
	post: {
		summary: 'Send an SMS to one or more recipients',
		tags: ['sms'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		requestBody: {
			required: true,
			content: {
				'application/json': {
					schema: {
						type: 'object',
						required: ['recipients', 'message'],
						properties: {
							recipients: { type: 'array', items: { type: 'string' }, description: 'Phone numbers' },
							message: { type: 'string' },
							fromNumber: { type: 'string', description: 'Defaults to the company number' }
						}
					}
				}
			}
		},
		responses: {
			200: {
				description: 'Send result per recipient',
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								success: { type: 'boolean' },
								data: {
									type: 'object',
									properties: {
										results: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													recipient: { type: 'string' },
													messageId: { type: 'string' },
													status: { type: 'string', enum: ['sent', 'failed'] },
													error: { type: 'string' }
												}
											}
										}
									}
								}
							}
						}
					}
				}
			},
			400: { description: 'recipients and message are required', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/sms/history', {
	get: {
		summary: 'List SMS history for the company',
		tags: ['sms'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		parameters: [
			{ name: 'limit', in: 'query', schema: { type: 'integer' } },
			{ name: 'offset', in: 'query', schema: { type: 'integer' } }
		],
		responses: {
			200: { description: 'SMS log entries', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/sms/history/{contactId}', {
	get: {
		summary: 'List SMS history for one contact',
		tags: ['sms'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		parameters: [{ name: 'contactId', in: 'path', required: true, schema: { type: 'string' } }],
		responses: {
			200: { description: 'SMS log entries for the contact', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/calls/history', {
	get: {
		summary: 'List call history for the company',
		tags: ['calls'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: { description: 'Call log entries', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/calls/history/{contactId}', {
	get: {
		summary: 'List call history for one contact',
		tags: ['calls'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		parameters: [{ name: 'contactId', in: 'path', required: true, schema: { type: 'string' } }],
		responses: {
			200: { description: 'Call log entries for the contact', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/communication-logs', {
	get: {
		summary: 'List communication logs (voice + sms + email) for the company',
		tags: ['communication-logs'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		parameters: [
			{ name: 'limit', in: 'query', schema: { type: 'integer' } },
			{ name: 'offset', in: 'query', schema: { type: 'integer' } },
			{ name: 'type', in: 'query', schema: { type: 'string', enum: ['voice', 'sms', 'email'] } }
		],
		responses: {
			200: { description: 'Communication log entries', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/contacts', {
	get: {
		summary: 'List contacts for the company',
		tags: ['contacts'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: { description: 'Contacts', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/notifications', {
	get: {
		summary: 'List notifications for the company',
		tags: ['notifications'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
		responses: {
			200: { description: 'Notifications', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/notifications/unread-count', {
	get: {
		summary: 'Unread notification count for the user',
		tags: ['notifications'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: { description: 'Unread count', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/push/register', {
	post: {
		summary: 'Register a device for push notifications (APNs/FCM tokens)',
		tags: ['push'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		requestBody: {
			required: true,
			content: {
				'application/json': {
					schema: {
						type: 'object',
						required: ['deviceId'],
						properties: {
							deviceId: { type: 'string' },
							platform: { type: 'string', enum: ['ios', 'android', 'web'] },
							fcmToken: { type: 'string' },
							voipToken: { type: 'string' }
						}
					}
				}
			}
		},
		responses: {
			200: { description: 'Device registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/fcm/store-token', {
	post: {
		summary: 'Store an FCM token for the authenticated user',
		tags: ['push'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: { description: 'Token stored', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

override('/api/company-numbers', {
	get: {
		summary: 'List phone numbers assigned to the company',
		tags: ['company', 'numbers'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		responses: {
			200: { description: 'Assigned numbers', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	},
	post: {
		summary: 'Assign a phone number to the company',
		tags: ['company', 'numbers'],
		security: [{ bearerAuth: [] }, { cookieAuth: [] }],
		requestBody: {
			required: true,
			content: {
				'application/json': {
					schema: {
						type: 'object',
						required: ['phoneNumber'],
						properties: {
							phoneNumber: { type: 'string', description: 'E.164 format' },
							telnyxPhoneNumberId: { type: 'string' },
							connectionLabel: { type: 'string' }
						}
					}
				}
			}
		},
		responses: {
			200: { description: 'Number assigned', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } },
			401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
		}
	}
});

// ---------------------------------------------------------------------------
// 3. Build the spec
// ---------------------------------------------------------------------------

const components = {
	securitySchemes: {
		bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
		cookieAuth: { type: 'apiKey', in: 'cookie', name: 'app_session' }
	},
	schemas: {
		Error: {
			type: 'object',
			required: ['success', 'error'],
			properties: {
				success: { type: 'boolean' },
				error: { type: 'string' },
				code: { type: 'integer' }
			}
		},
		Success: {
			type: 'object',
			required: ['success'],
			properties: { success: { type: 'boolean' } }
		},
		DataEnvelope: {
			type: 'object',
			properties: {
				success: { type: 'boolean' },
				data: { additionalProperties: true }
			}
		},
		Company: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				name: { type: 'string' },
				ownerId: { type: 'string' },
				emailSlug: { type: 'string' },
				logo: { type: 'string' }
			}
		},
		User: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				email: { type: 'string', format: 'email' },
				name: { type: 'string' },
				role: { type: 'string' },
				platformRole: { type: 'string' },
				verified: { type: 'boolean' },
				avatar: { type: 'string' },
				company: { $ref: '#/components/schemas/Company' }
			}
		},
		UserTokenResponse: {
			type: 'object',
			properties: {
				success: { type: 'boolean' },
				token: { type: 'string' },
				user: { $ref: '#/components/schemas/User' }
			}
		},
		CompanyPhoneNumber: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				companyId: { type: 'string' },
				phoneNumber: { type: 'string' },
				telnyxPhoneNumberId: { type: 'string' },
				connectionLabel: { type: 'string' },
				callFlowId: { type: 'string' },
				callTrackingCategoryId: { type: 'string' }
			}
		},
		Contact: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				companyId: { type: 'string' },
				name: { type: 'string' },
				phone: { type: 'string' },
				email: { type: 'string' },
				landline: { type: 'string' },
				cell: { type: 'string' },
				smsPermission: { type: 'boolean' },
				contactType: { type: 'string' },
				avatarUrl: { type: 'string' }
			}
		},
		SipCredentials: {
			type: 'object',
			properties: {
				success: { type: 'boolean' },
				data: {
					type: 'object',
					properties: {
						connectionId: { type: 'string' },
						callerIdName: { type: 'string' },
						callerIdNumber: { type: 'string' },
						webrtcToken: { type: 'string', description: 'Short-lived JWT for the Telnyx WebRTC SDK' }
					}
				}
			}
		}
	}
};

const paths = {};

for (const file of files) {
	const source = readFileSync(file, 'utf8');
	const path = toOpenApiPath(file);
	const methods = extractMethods(source);
	if (!methods.length) continue;

	const isWebhook = WEBHOOKISH.test(path);
	const isPublic = isWebhook || PUBLIC.test(path);
	const summary = extractSummary(source);
	const bodyFields = extractBodyFields(source);
	const queryParams = extractQueryParams(source);
	const needsAuth = !isPublic && /locals\.user|requireAuth|Unauthorized/.test(source);

	const pathItem = OVERRIDES[path] ? { ...OVERRIDES[path] } : {};

	for (const method of methods) {
		const lower = method.toLowerCase();
		if (pathItem[lower]) continue; // override wins
		if (method === 'ALL') continue; // fallback catch-all: skip in spec

		const item = { summary, tags: [path.split('/')[2] || 'api'] };

		if (lower === 'get' && queryParams.length) {
			item.parameters = queryParams.map((name) => ({
				name,
				in: 'query',
				schema: { type: 'string' }
			}));
		}

		if (['post', 'put', 'patch'].includes(lower) && bodyFields.length) {
			const properties = {};
			for (const f of bodyFields) properties[f] = { type: 'string' };
			item.requestBody = {
				content: {
					'application/json': {
						schema: { type: 'object', properties }
					}
				}
			};
		}

		if (needsAuth) item.security = [{ bearerAuth: [] }, { cookieAuth: [] }];

		item.responses = {
			200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/DataEnvelope' } } } }
		};
		if (needsAuth) {
			item.responses[401] = { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
		}
		if (!isWebhook) {
			item.responses[500] = { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
		}

		pathItem[lower] = item;
	}

	paths[path] = pathItem;
}

// ---------------------------------------------------------------------------
// 4. Emit files
// ---------------------------------------------------------------------------

function dumpYaml(obj) {
	// js-yaml emits valid YAML with 2-space indent for these plain structures.
	return yaml.dump(obj, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false });
}

const header =
	'/**\n * GENERATED FILE - do not edit by hand.\n * Regenerate with: node scripts/gen-openapi.mjs\n */\n';

// 4a. shared schemas file
const schemasJs =
	header +
	'\n/**\n * @swagger\n' +
	dumpYaml({ components })
		.split('\n')
		.map((l) => ' * ' + l)
		.join('\n') +
	'\n */\n';

// 4b. paths file
let pathsJs = header + '\n';
for (const [path, pathItem] of Object.entries(paths)) {
	const block = {};
	block[path] = pathItem;
	pathsJs +=
		'/**\n * @swagger\n' +
		dumpYaml(block)
			.split('\n')
			.map((l) => ' * ' + l)
			.join('\n') +
		'\n */\n\n';
}

writeFileSync(join(OUT_DIR, 'openapi-schemas.generated.js'), schemasJs);
writeFileSync(join(OUT_DIR, 'openapi-paths.generated.js'), pathsJs);

// 4c. full spec as a server-bundled module (consumed by GET /docs/spec.json).
// Kept out of `static/` so it is never served publicly — the /docs* routes are
// gated by an access code in hooks.server.ts.
function loadEnvFile(name) {
	try {
		const match = readFileSync(join(process.cwd(), '.env'), 'utf8').match(
			new RegExp(`^${name}=(.*)$`, 'm')
		);
		return match ? match[1].trim() : null;
	} catch {
		return null;
	}
}

const publicBaseUrl = (process.env.PUBLIC_BASE_URL || loadEnvFile('PUBLIC_BASE_URL') || 'http://localhost:3005').replace(
	/\/+$/,
	''
);

const fullSpec = {
	openapi: '3.0.0',
	info: {
		title: 'ClearSky / A2P Backend API',
		version: '1.0.0',
		description:
			'REST API for the ClearSky dialer, messaging, contacts, notifications and call tracking backend. Auth via `Authorization: Bearer <token>` (token returned by POST /api/auth/login) or the app_session cookie.'
	},
	servers: [{ url: publicBaseUrl, description: 'Backend server' }],
	paths,
	components
};

const specJs =
	header +
	'\n// @ts-nocheck\n' +
	`export default ${JSON.stringify(fullSpec, null, 2)};\n`;
writeFileSync(join(OUT_DIR, 'openapi-spec.generated.js'), specJs);

console.log(`Generated ${Object.keys(paths).length} path docs from ${files.length} route files`);
console.log(`  ${join(OUT_DIR, 'openapi-schemas.generated.js')}`);
console.log(`  ${join(OUT_DIR, 'openapi-paths.generated.js')}`);
console.log(`  ${join(OUT_DIR, 'openapi-spec.generated.js')}`);
