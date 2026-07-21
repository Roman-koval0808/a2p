export interface EventConfig {
  eventType: string;
  delta: number;
  method: number; // 1 | 2 | 3 | 4 | 5
  bucketSignal?: 'research' | 'comparison' | 'active' | 'emergency' | 'conversion' | 'friction' | 'disengagement';
  channelType: string;
}

export const eventRegistry: Record<string, EventConfig> = {
  page_load: { eventType: 'page_load', delta: 0, method: 2, channelType: 'pixel' },
  scroll_25: { eventType: 'scroll_25', delta: 3, method: 2, bucketSignal: 'research', channelType: 'pixel' },
  scroll_50: { eventType: 'scroll_50', delta: 5, method: 2, bucketSignal: 'research', channelType: 'pixel' },
  scroll_75: { eventType: 'scroll_75', delta: 7, method: 2, bucketSignal: 'comparison', channelType: 'pixel' },
  scroll_90: { eventType: 'scroll_90', delta: 10, method: 2, bucketSignal: 'comparison', channelType: 'pixel' },
  dwell_30: { eventType: 'dwell_30', delta: 4, method: 2, bucketSignal: 'research', channelType: 'pixel' },
  dwell_60: { eventType: 'dwell_60', delta: 7, method: 2, bucketSignal: 'comparison', channelType: 'pixel' },
  dwell_120: { eventType: 'dwell_120', delta: 10, method: 2, bucketSignal: 'comparison', channelType: 'pixel' },
  page_view_pricing: { eventType: 'page_view_pricing', delta: 8, method: 2, bucketSignal: 'comparison', channelType: 'pixel' },
  page_view_reviews: { eventType: 'page_view_reviews', delta: 6, method: 2, bucketSignal: 'comparison', channelType: 'pixel' },
  // Gallery is a comparison-stage page (brief P1.3 regression case: score 17 + gallery → comparison).
  page_view_gallery: { eventType: 'page_view_gallery', delta: 6, method: 2, bucketSignal: 'comparison', channelType: 'pixel' },
  hero_cta_click: { eventType: 'hero_cta_click', delta: 12, method: 2, bucketSignal: 'active', channelType: 'pixel' },
  emg_cta_click: { eventType: 'emg_cta_click', delta: 20, method: 2, bucketSignal: 'emergency', channelType: 'pixel' },
  // Tracker #31: sustained dwell on the home-page Emergency band itself (before any nav/CTA).
  // Distinct from generic dwell_* — signals emergency intent while still on the home page.
  emergency_band_dwell: { eventType: 'emergency_band_dwell', delta: 18, method: 2, bucketSignal: 'emergency', channelType: 'pixel' },
  phone_click: { eventType: 'phone_click', delta: 15, method: 2, bucketSignal: 'active', channelType: 'pixel' },
  nav_emergency: { eventType: 'nav_emergency', delta: 15, method: 2, bucketSignal: 'emergency', channelType: 'pixel' },
  email_cta_click: { eventType: 'email_cta_click', delta: 12, method: 2, bucketSignal: 'active', channelType: 'email' },
  ad_session_start: { eventType: 'ad_session_start', delta: 0, method: 1, channelType: 'pixel' },
  owned_channel_session_start: { eventType: 'owned_channel_session_start', delta: 0, method: 1, channelType: 'pixel' },
  form_submit: { eventType: 'form_submit', delta: 20, method: 2, bucketSignal: 'conversion', channelType: 'pixel' },
  phone_field_focus: { eventType: 'phone_field_focus', delta: 10, method: 2, bucketSignal: 'active', channelType: 'pixel' },
  name_field_focus: { eventType: 'name_field_focus', delta: 6, method: 2, bucketSignal: 'active', channelType: 'pixel' },
  form_abandon: { eventType: 'form_abandon', delta: -8, method: 2, bucketSignal: 'friction', channelType: 'pixel' },
  rage_click: { eventType: 'rage_click', delta: -5, method: 2, bucketSignal: 'friction', channelType: 'pixel' },
  dead_click: { eventType: 'dead_click', delta: -3, method: 2, bucketSignal: 'friction', channelType: 'pixel' },
  chat_close_no_send: { eventType: 'chat_close_no_send', delta: -4, method: 2, bucketSignal: 'friction', channelType: 'pixel' },
  page_exit_fast: { eventType: 'page_exit_fast', delta: -6, method: 2, bucketSignal: 'disengagement', channelType: 'pixel' },
  apt_form_abandon: { eventType: 'apt_form_abandon', delta: -12, method: 2, bucketSignal: 'disengagement', channelType: 'pixel' },
  appointment_noshow: { eventType: 'appointment_noshow', delta: -20, method: 2, bucketSignal: 'disengagement', channelType: 'pixel' },
  visualizer_session_start: { eventType: 'visualizer_session_start', delta: 8, method: 2, bucketSignal: 'comparison', channelType: 'pixel' },
  own_photo_uploaded: { eventType: 'own_photo_uploaded', delta: 12, method: 2, bucketSignal: 'active', channelType: 'pixel' },
  result_saved: { eventType: 'result_saved', delta: 15, method: 2, bucketSignal: 'active', channelType: 'pixel' },
  viewroom_entered: { eventType: 'viewroom_entered', delta: 10, method: 2, bucketSignal: 'active', channelType: 'pixel' },
  appointment_booked: { eventType: 'appointment_booked', delta: 25, method: 2, bucketSignal: 'conversion', channelType: 'pixel' },
  inbound_call: { eventType: 'inbound_call', delta: 12, method: 3, bucketSignal: 'active', channelType: 'phone' },
  gbp_review_received: { eventType: 'gbp_review_received', delta: 0, method: 3, channelType: 'gbp' },
  voicemail_received: { eventType: 'voicemail_received', delta: 15, method: 3, bucketSignal: 'active', channelType: 'phone' },
  telnyx_voice_transcription: { eventType: 'telnyx_voice_transcription', delta: 15, method: 3, bucketSignal: 'active', channelType: 'phone' },
  sms_received: { eventType: 'sms_received', delta: 10, method: 3, bucketSignal: 'active', channelType: 'sms' },
  telnyx_sms_received: { eventType: 'telnyx_sms_received', delta: 10, method: 3, bucketSignal: 'active', channelType: 'sms' },
};
