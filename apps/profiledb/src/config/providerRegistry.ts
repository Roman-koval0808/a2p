export interface ProviderConfig {
  provider: string;
  stream: 'A' | 'B';
  method: 1 | 2 | 3 | 4 | 5;
  group: 1 | 2 | 3 | 4;
  inputMechanism: string;
  authType: 'webhook_signature' | 'client_api_key' | 'internal_pull' | 'platform_native';
  schema: {
    required: string[];
    types: Record<string, 'string' | 'number' | 'boolean' | 'object'>;
  };
}

export const providerRegistry: Record<string, ProviderConfig> = {
  // Stream A
  google_ads: {
    provider: 'google_ads',
    stream: 'A',
    method: 1,
    group: 2,
    inputMechanism: 'utm_pixel',
    authType: 'client_api_key',
    schema: {
      required: ['tenantSlug', 'fingerprintId'],
      types: { tenantSlug: 'string', fingerprintId: 'string' }
    }
  },
  telnyx_voice: {
    provider: 'telnyx_voice',
    stream: 'A',
    method: 3,
    group: 3,
    inputMechanism: 'telnyx_realtime',
    authType: 'webhook_signature',
    schema: {
      // fingerprintId not required — controller generates a deterministic synthetic fingerprint
      // from the phone hash (E.164 normalised) when a real browser fingerprint is absent.
      required: ['tenantSlug', 'phone'],
      types: { tenantSlug: 'string', phone: 'string' }
    }
  },
  telnyx_sms: {
    provider: 'telnyx_sms',
    stream: 'A',
    method: 3,
    group: 3,
    inputMechanism: 'telnyx_realtime',
    authType: 'webhook_signature',
    schema: {
      // fingerprintId not required — synthetic fingerprint generated from phone hash.
      required: ['tenantSlug', 'phone'],
      types: { tenantSlug: 'string', phone: 'string' }
    }
  },
  gbp_review: {
    provider: 'gbp_review',
    stream: 'A',
    method: 3,
    group: 4,
    inputMechanism: 'webhook_push',
    authType: 'webhook_signature',
    schema: {
      // fingerprintId not required — synthetic fingerprint generated from review_id anchor.
      required: ['tenantSlug', 'name'],
      types: { tenantSlug: 'string', name: 'string' }
    }
  },
  email_link: {
    provider: 'email_link',
    stream: 'A',
    method: 1,
    group: 1,
    inputMechanism: 'cs_token_jwt',
    authType: 'platform_native',
    schema: {
      required: ['tenantSlug', 'fingerprintId'],
      types: { tenantSlug: 'string', fingerprintId: 'string' }
    }
  },
  sms_link: {
    provider: 'sms_link',
    stream: 'A',
    method: 1,
    group: 1,
    inputMechanism: 'cs_token_jwt',
    authType: 'platform_native',
    schema: {
      required: ['tenantSlug', 'fingerprintId'],
      types: { tenantSlug: 'string', fingerprintId: 'string' }
    }
  },
  qr_link: {
    provider: 'qr_link',
    stream: 'A',
    method: 1,
    group: 1,
    inputMechanism: 'cs_token_jwt',
    authType: 'platform_native',
    schema: {
      required: ['tenantSlug', 'fingerprintId'],
      types: { tenantSlug: 'string', fingerprintId: 'string' }
    }
  },
  clearsky_pixel: {
    provider: 'clearsky_pixel',
    stream: 'A',
    method: 2,
    group: 2,
    inputMechanism: 'utm_pixel',
    authType: 'client_api_key',
    schema: {
      required: ['tenantSlug', 'fingerprintId'],
      types: { tenantSlug: 'string', fingerprintId: 'string' }
    }
  },

  // Stream B
  dataforseo: {
    provider: 'dataforseo',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  matomo: {
    provider: 'matomo',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  sudbury_watch: {
    provider: 'sudbury_watch',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  sault_watch: {
    provider: 'sault_watch',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  thunder_watch: {
    provider: 'thunder_watch',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  north_watch: {
    provider: 'north_watch',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  cohort_1: {
    provider: 'cohort_1',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  cohort_2: {
    provider: 'cohort_2',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  contentradar_flags: {
    provider: 'contentradar_flags',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  env_canada: {
    provider: 'env_canada',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  viewroom_aggregate: {
    provider: 'viewroom_aggregate',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  youtube_perf: {
    provider: 'youtube_perf',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  facebook_perf: {
    provider: 'facebook_perf',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  },
  system_health: {
    provider: 'system_health',
    stream: 'B',
    method: 2,
    group: 4,
    inputMechanism: 'polling_pull',
    authType: 'internal_pull',
    schema: {
      required: ['tenantSlug'],
      types: { tenantSlug: 'string' }
    }
  }
};
