import { leadboxStyles } from './styles';
import { icons } from './icons';

export interface LeadboxConfig {
	id: string;
	leadboxData: any;
	companyId: string;
	baseUrl: string;
	/** Shown in the footer between the two policy links. Falls back to "ClearSky". */
	companyName?: string;
}

function escapeForJs(str: string): string {
	return JSON.stringify(str);
}

export function buildLeadboxScript(config: LeadboxConfig): string {
	const { id, leadboxData, companyId, baseUrl } = config;

	// Prepare data for injection
	const dataJson = JSON.stringify({ ...leadboxData, leadBoxOpen: false });
	const iconsJson = JSON.stringify(icons);
	const stylesJson = JSON.stringify(leadboxStyles);

	// Build the script with proper escaping
	return `(function() {
  const leadboxData = ${dataJson};
  const companyId = ${escapeForJs(companyId)};
  const baseUrl = ${escapeForJs(baseUrl)};
  const leadboxId = ${escapeForJs(id)};
  const companyName = ${escapeForJs(config.companyName || '')};
  const icons = ${iconsJson};

  function getIcon(name) {
    return icons[name] || '';
  }

  const DISCLAIMER = "By submitting, you agree to receive informational text messages. Consent is optional &amp; content may be automated. Msg/data rates apply, msg frequency varies. Text HELP for help. Text STOP to stop.";

  /* --- telemetry -----------------------------------------------------------
     Mirrors the a2p client + site client: same fingerprint resolution (?fp= →
     localStorage → CDN-free local fallback, persisted) so embed signals merge
     into the same visitor thread. Resolved lazily per signal so a fingerprint
     written by the marketing site's client after page load is picked up. */
  var sessionId = 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function localFingerprint() {
    var parts = [
      navigator.userAgent || '',
      navigator.language || '',
      (Array.isArray(navigator.languages) ? navigator.languages.join(',') : ''),
      navigator.platform || '',
      String(navigator.hardwareConcurrency || ''),
      String(navigator.deviceMemory || ''),
      String(window.screen ? window.screen.width : ''),
      String(window.screen ? window.screen.height : ''),
      String(window.screen ? window.screen.colorDepth : ''),
      (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone || '' : ''),
      String(new Date().getTimezoneOffset())
    ];
    var seed = parts.join('|');
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < seed.length; i++) {
      var c = seed.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193);
      h2 ^= c; h2 = Math.imul(h2, 0x85ebca6b);
    }
    var hex = (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
    while (hex.length < 16) hex = '0' + hex;
    return hex.slice(0, 12);
  }

  function resolveFingerprint() {
    try {
      var urlFp = new URLSearchParams(window.location.search).get('fp');
      if (urlFp) return urlFp;
      var stored = window.localStorage.getItem('fingerprintId') || window.localStorage.getItem('fingerprint') || window.localStorage.getItem('fp');
      if (stored) return stored;
      var fp = localFingerprint();
      window.localStorage.setItem('fingerprintId', fp);
      return fp;
    } catch (e) {
      return '';
    }
  }

  function trackSignal(name, payload) {
    trackSignals([{ name: name, payload: payload || {} }]);
  }

  function trackSignals(signals) {
    try {
      var fp = resolveFingerprint();
      var list = signals.map(function (s) {
        return { name: s.name, occurredAt: new Date().toISOString(), payload: s.payload || {} };
      });
      if (window.console) {
        console.log('[clearsky-telemetry] signal fired', {
          signal: list.map(function (s) { return s.name; }).join('+'),
          fingerprintId: fp,
          sessionId: sessionId,
          tenantSlug: companyId
        });
      }
      var apiBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      var body = JSON.stringify({
        tenantSlug: companyId,
        sessionId: sessionId,
        fingerprintId: fp,
        signals: list
      });
      /* Transport, and why it is NOT sendBeacon-with-JSON.
         navigator.sendBeacon() forces the request's credentials mode to "include", and an
         application/json body is not a CORS-safelisted content type. Together those make the
         beacon a *credentialed* cross-origin preflight, which the intake's wildcard
         Access-Control-Allow-Origin: * can never satisfy — the browser drops the request
         while sendBeacon() still returns true, so every embed signal failed silently.
         fetch(keepalive) is the transport the marketing-site client already uses against this
         same endpoint, and keepalive survives page unload just as a beacon does. The beacon
         is kept only as a fallback, with a text/plain body so it stays a "simple" request
         (no-cors, no preflight) and is actually delivered. */
      var endpoint = apiBase + '/api/v1/telemetry/signals';
      if (typeof fetch === 'function') {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true
        }).catch(function () {
          if (navigator.sendBeacon) {
            navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }));
          }
        });
      } else if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }));
      }
    } catch (e) {
      /* telemetry must never break the widget */
    }
  }
  /* --- end telemetry ------------------------------------------------------- */

  /* The reference greys the button out until the form can actually be sent.
     checkValidity() covers the required fields without a second rule set. */
  function syncSubmitState(form) {
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = !form.checkValidity();
  }

  /* "Text with us." leads in bold and the rest reads as a sentence. Split on the first
     full stop so the bold half tracks whatever the admin typed, rather than being a
     separate configurable field. */
  function renderHeaderText(text) {
    const safe = String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const i = safe.indexOf('.');
    // Only a genuine LEAD is bolded — a sentence whose only full stop is its last
    // character ("Select times to get a call, & complete fields below.") stays regular,
    // which is how the reference renders that screen.
    if (i === -1 || !safe.slice(i + 1).trim()) return safe;
    return '<span class="clearsky-header-lead">' + safe.slice(0, i + 1) + '</span>' + safe.slice(i + 1);
  }

  function footerHtml() {
    // Privacy policy alone. The use-policy link and the brand name were in the earlier
    // reference but not in the Figma, and at 368px the three of them wrapped onto
    // three ragged lines.
    return '<div class="clearsky-footer-links">' +
      '<a class="clearsky-privacy-link">Privacy policy</a>' +
      '</div>';
  }

  function addStyles() {
    if (document.getElementById('clearsky-leadbox-styles')) return;
    const style = document.createElement('style');
    style.id = 'clearsky-leadbox-styles';
    style.textContent = ${stylesJson};
    document.head.appendChild(style);
  }

  function createChannelIcon(iconName) {
    return getIcon(iconName);
  }

  function createChannelButton(channel) {
    const channelData = {
      name: channel.name,
      value: channel.value,
      url: channel.url,
      type: channel.type || (channel.url && channel.url !== 'sms://' && channel.url !== 'tel://' ? 'link' : channel.name?.toLowerCase().includes('call') ? 'request_call' : 'text_us')
    };

    let iconHtml = '';
    if (channel.showIcon) {
      const channelIcon = getIcon(channel.icon);
      if (channelIcon) {
        iconHtml = '<div style="display: flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; margin-right: 0.5rem; flex-shrink: 0;">' + channelIcon + '</div>';
      }
    }

    const buttonColor = (channel.buttonColor || '#3B5BDB').replace(/"/g, '&quot;');
    const fontColor = (channel.fontColor || '#ffffff').replace(/"/g, '&quot;');
    const channelValue = (channel.value || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    
    let onClickScript = '';
    if (channelData.type === 'text_us') {
      onClickScript = 'switchLeadboxView(\\\'text_us\\\')';
    } else if (channelData.type === 'request_call') {
      onClickScript = 'switchLeadboxView(\\\'request_call\\\')';
    } else {
      onClickScript = 'handleChannelClick(' + JSON.stringify(channel.url || 'https://') + ', ' + JSON.stringify(channel.target || '_blank') + ', ' + JSON.stringify(channelData) + ')';
    }
    const escapedOnClick = onClickScript.replace(/"/g, '&quot;');
    
    return '<button class="clearsky-button" type="button" style="background-color: ' + buttonColor + '; color: ' + fontColor + ';" onclick="' + escapedOnClick + '">' + iconHtml + '<span>' + channelValue + '</span></button>';
  }

  function createTextUsHtml() {
    // The card holds only the fields. The disclaimer and the button sit on the grey
    // beneath it, and the footer is a white bar rendered by createOpenLeadbox.
    return '<form id="clearsky-textus-form" onsubmit="handleSubformSubmit(event, \\\'text_us\\\')" oninput="syncSubmitState(this)">' +
      '<div class="clearsky-subform-card">' +
      '<div class="clearsky-field-row"><label class="clearsky-field-label">Full Name</label><input type="text" name="name" class="clearsky-field-input" required /></div>' +
      '<div class="clearsky-field-row"><label class="clearsky-field-label">Mobile Number</label><input type="tel" name="mobile" class="clearsky-field-input" required /></div>' +
      '<div class="clearsky-field-row clearsky-field-stacked"><label class="clearsky-field-label">Message</label><textarea name="message" class="clearsky-field-textarea" required></textarea></div>' +
      '</div>' +
      '<p class="clearsky-subform-disclaimer">' + DISCLAIMER + '</p>' +
      '<div class="clearsky-subform-actions"><button type="submit" class="clearsky-subform-submit" disabled>SEND</button></div>' +
      '</form>';
  }

  function createRequestCallHtml() {
    return '<form id="clearsky-requestcall-form" onsubmit="handleSubformSubmit(event, \\\'request_call\\\')" oninput="syncSubmitState(this)">' +
      '<div class="clearsky-subform-card">' +
      '<div class="clearsky-field-row"><label class="clearsky-field-label">Full Name</label><input type="text" name="name" class="clearsky-field-input" required /></div>' +
      '<div class="clearsky-field-row"><label class="clearsky-field-label">Mobile Number</label><input type="tel" name="mobile" class="clearsky-field-input" required /></div>' +
      '<div class="clearsky-field-times">' +
      '<label class="clearsky-times-label">Select preferred times</label>' +
      '<div class="clearsky-time-pills">' +
      '<input type="hidden" name="preferred_time" id="clearsky-preferred-time" value="ASAP" />' +
      '<button type="button" class="clearsky-time-pill active" onclick="selectTimePill(this, \\\'ASAP\\\')">ASAP</button>' +
      '<button type="button" class="clearsky-time-pill" onclick="selectTimePill(this, \\\'Morning\\\')">Morning</button>' +
      '<button type="button" class="clearsky-time-pill" onclick="selectTimePill(this, \\\'Afternoon\\\')">Afternoon</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<p class="clearsky-subform-disclaimer">' + DISCLAIMER + '</p>' +
      '<div class="clearsky-subform-actions"><button type="submit" class="clearsky-subform-submit" disabled>SEND</button></div>' +
      '</form>';
  }

  async function handleSubformSubmit(event, formType) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.7';
      submitBtn.textContent = 'Submitting...';
      submitBtn.style.cursor = 'not-allowed';
    }

    const formData = new FormData(form);
    const data = Object.fromEntries(formData);

    if (formType === 'request_call') {
      trackSignal('callback_submit', { preferredTime: data.preferred_time || 'ASAP' });
    }

    try {
      const initials = data.name ? data.name.split(' ').map(n => n[0]).join('').toUpperCase() : '??';
      let messageContent = data.message || '';
      if (formType === 'request_call') {
        const timeChoice = data.preferred_time || 'ASAP';
        messageContent = 'Requested Call back. Preferred Time: ' + timeChoice;
      }
      const normalizedPhone = data.mobile ? data.mobile.replace(/[^+\\d]/g, '') : "";

      const messageData = {
        customer_name: data.name || "Anonymous",
        customer_email: "",
        customer_phone: data.mobile || "",
        message: messageContent,
        source: "leadbox",
        status: "new",
        thread_id: normalizedPhone || crypto.randomUUID(),
        source_url: window.location.href,
        company_id: companyId,
        created: new Date().toISOString(),
        initials: initials,
        color: "bg-primary",
        scenario_key: formType === 'request_call' ? 's2' : 's1'
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const apiBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const response = await fetch(apiBase + '/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messageData),
          mode: 'cors',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          form.innerHTML = '<div style="text-align: center; padding: 2rem 1rem; color: #EF4444;"><h3 style="font-size: 1.125rem; font-weight: 700; margin-bottom: 0.5rem;">Error</h3><p style="font-size: 0.875rem; margin-bottom: 1rem;">There was an error submitting your request. Please try again.</p><button type="button" class="clearsky-button" style="background-color: #3B5BDB;" onclick="switchLeadboxView(\\\'main\\\')">Back</button></div>';
          return;
        }

        form.innerHTML = '<div style="text-align: center; padding: 2rem 1rem;"><div style="width: 48px; height: 48px; border-radius: 9999px; background-color: #DCFCE7; color: #16A34A; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem auto; font-size: 24px; font-weight: bold;">✓</div><h3 style="font-size: 1.25rem; font-weight: 700; color: #111827; margin: 0 0 0.5rem 0;">Thank you!</h3><p style="color: #6B7280; font-size: 0.875rem; margin: 0 0 1.5rem 0;">Your request has been received. We\\'ll be in touch shortly.</p><button type="button" class="clearsky-button" style="background-color: #3B5BDB;" onclick="switchLeadboxView(\\\'main\\\')">Done</button></div>';
      } catch (fetchError) {
        clearTimeout(timeoutId);
        form.innerHTML = '<div style="text-align: center; padding: 2rem 1rem; color: #EF4444;"><h3 style="font-size: 1.125rem; font-weight: 700; margin-bottom: 0.5rem;">Error</h3><p style="font-size: 0.875rem; margin-bottom: 1rem;">Could not connect to server. Please check your connection and try again.</p><button type="button" class="clearsky-button" style="background-color: #3B5BDB;" onclick="switchLeadboxView(\\\'main\\\')">Back</button></div>';
      }
    } catch (error) {
      console.error('Error in handleSubformSubmit:', error);
      form.innerHTML = '<div style="text-align: center; padding: 2rem 1rem; color: #EF4444;"><h3 style="font-size: 1.125rem; font-weight: 700; margin-bottom: 0.5rem;">Error</h3><p style="font-size: 0.875rem; margin-bottom: 1rem;">There was an unexpected error. Please try again.</p><button type="button" class="clearsky-button" style="background-color: #3B5BDB;" onclick="switchLeadboxView(\\\'main\\\')">Back</button></div>';
    }
  }

  function switchLeadboxView(view) {
    if (view === 'request_call') {
      trackSignals([
        { name: 'callback_open' },
        { name: 'callback_form_open' }
      ]);
    }
    const container = document.getElementById('clearsky-leadbox-' + leadboxId);
    if (!container) return;
    const box = container.querySelector('.clearsky-box');
    if (box) {
      container.innerHTML = createOpenLeadbox(view);
    }
  }

  function selectTimePill(btn, time) {
    const parent = btn.parentElement;
    if (parent) {
      const pills = parent.querySelectorAll('.clearsky-time-pill');
      pills.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const hiddenInput = parent.querySelector('#clearsky-preferred-time');
      if (hiddenInput) {
        hiddenInput.value = time;
      }
    }
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.7';
      submitBtn.textContent = 'Submitting...';
      submitBtn.style.cursor = 'not-allowed';
    }

    const formData = new FormData(form);
    const data = Object.fromEntries(formData);

    try {
      const initials = data.name ? data.name.split(' ').map(n => n[0]).join('').toUpperCase() : '??';
      const messageContent = data.message || '';
      const normalizedPhone = data.mobile ? data.mobile.replace(/[^+\\d]/g, '') : "";

      const messageData = {
        customer_name: data.name || "Anonymous",
        customer_email: "",
        customer_phone: data.mobile || "",
        message: messageContent,
        source: "leadbox",
        status: "new",
        thread_id: normalizedPhone || crypto.randomUUID(),
        source_url: window.location.href,
        company_id: companyId,
        created: new Date().toISOString(),
        initials: initials,
        color: "bg-primary",
        company: { id: companyId }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const apiBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        const response = await fetch(apiBase + '/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messageData),
          mode: 'cors',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.error('Server error:', response.status);
          const errorData = await response.json().catch(() => null);
          console.error('Error data:', errorData);
          form.innerHTML = '<div style="text-align: center; padding: 2rem; color: #EF4444;"><h3>Error</h3><p>There was an error submitting your message. Please try again.</p></div>';
          return;
        }

        form.innerHTML = '<div style="text-align: center; padding: 2rem;"><h3>Thank you!</h3><p>Your message has been received.</p></div>';

      } catch (fetchError) {
        clearTimeout(timeoutId);
        console.error('Fetch error:', fetchError);
        
        let errorMessage = 'There was an error submitting your message. Please try again.';
        if (fetchError.name === 'AbortError') {
          console.error('Request timed out');
          errorMessage = 'The request took too long. Please try again.';
        }

        form.innerHTML = '<div style="text-align: center; padding: 2rem; color: #EF4444;"><h3>Error</h3><p>' + errorMessage + '</p></div>';
      }
    } catch (error) {
      console.error('Error in handleFormSubmit:', error);
      form.innerHTML = '<div style="text-align: center; padding: 2rem; color: #EF4444;"><h3>Error</h3><p>There was an error submitting your message. Please try again.</p></div>';
    }
  }

  function createOpenLeadbox(view) {
    const currentView = view || 'main';
    let bodyHtml = '';
    let headerText = '';
    let isSubform = false;

    if (currentView === 'text_us') {
      bodyHtml = createTextUsHtml();
      headerText = 'Text with us. Enter your info below and we will text you back.';
      isSubform = true;
    } else if (currentView === 'request_call') {
      bodyHtml = createRequestCallHtml();
      headerText = 'Select times to get a call, & complete fields below.';
      isSubform = true;
    } else if (leadboxData.textOnly) {
      bodyHtml = '<form id="clearsky-form" onsubmit="handleFormSubmit(event)" class="clearsky-form-fields"><input type="text" name="name" placeholder="Name" class="clearsky-input" required /><input type="tel" name="mobile" placeholder="Mobile Number" class="clearsky-input" required /><textarea name="message" placeholder="Message" class="clearsky-input" style="min-height: 100px;" required></textarea><div class="text-sm text-gray-500 mb-4 text-center">By submitting, you agree to receive text messages at this mobile number. Message & data rates apply.</div><button type="submit" class="clearsky-button" style="background-color: #3B5BDB;">Send Message</button></form>';
      headerText = leadboxData.topBanner?.text || 'Text with us. Message us now, book a demo, or start a free trial.';
    } else {
      const buttonsHtml = (leadboxData.channels || []).map(channel => createChannelButton(channel)).join('');
      bodyHtml = '<div class="clearsky-buttons">' + buttonsHtml + '</div>';
      headerText = leadboxData.topBanner?.text || 'Text with us. Message us now, book a demo, or start a free trial.';
    }

    let logoUrl = leadboxData.logoImage || '';
    if (logoUrl.startsWith('/')) {
        const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        logoUrl = base + logoUrl;
    }
    const logoImg = logoUrl.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    
    const bannerBgColor = (leadboxData.topBanner?.backgroundColor || '#3B5BDB').replace(/"/g, '&quot;');
    const bannerFontColor = (leadboxData.topBanner?.fontColor || '#ffffff').replace(/"/g, '&quot;');
    const bannerFontFamily = (leadboxData.topBanner?.fontFamily || 'sans-serif').replace(/"/g, '&quot;');

    const backBtnHtml = isSubform ? '<button type="button" class="clearsky-back-btn" onclick="switchLeadboxView(\\\'main\\\')" aria-label="Back">←</button>' : '';

    const cancelFabColor = (leadboxData.closedState?.bannerBgColor || bannerBgColor).replace(/"/g, '&quot;');
    const floatingCancelHtml = '<div style="display: flex; justify-content: flex-end; margin-top: 1rem;">' +
      '<button type="button" class="clearsky-cancel-fab" style="background-color: ' + cancelFabColor + ';" onclick="toggleLeadbox()" aria-label="Close leadbox">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
      '</button>' +
      '</div>';

    // Request-a-call carries an extra field, so the reference moves the logo inline to the
    // left of the header text instead of centring it on the header/body seam. Every other
    // view keeps the overhanging logo, which is why the body reserves clearance for it.
    const inlineLogo = currentView === 'request_call';
    // A missing or unreachable logo renders as the browser's torn-image glyph, which looks
    // broken inside the white circle. Hide the img and leave a clean disc instead.
    const logoHtml = logoImg
      ? '<div class="clearsky-logo"><img src="' + logoImg + '" alt="" onerror="this.remove()" /></div>'
      : '<div class="clearsky-logo"></div>';

    return '<div class="clearsky-box clearsky-animate-in">' +
      '<div class="clearsky-header' + (inlineLogo ? ' clearsky-header-inline' : '') + '" style="background-color: ' + bannerBgColor + '; color: ' + bannerFontColor + '; font-family: ' + bannerFontFamily + ';">' +
      backBtnHtml +
      '<button type="button" class="clearsky-close-btn" onclick="toggleLeadbox()" aria-label="Close">\u2715</button>' +
      (inlineLogo ? logoHtml : '') +
      '<p class="clearsky-header-text">' + renderHeaderText(headerText) + '</p>' +
      (inlineLogo ? '' : '<div class="clearsky-header-spacer"></div>' + logoHtml) +
      '</div>' +
      '<div class="clearsky-content' + (inlineLogo ? ' clearsky-content-inline' : '') + '">' + bodyHtml + '</div>' +
      footerHtml() +
      '</div>' +
      floatingCancelHtml;
  }

  function createClosedLeadbox() {
    const cs = leadboxData.closedState || {};
    const primaryBtn = leadboxData.primaryButton || {};

    const bannerText = (cs.bannerText || 'QUESTIONS? JUST ASK!').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bannerBgColor = (cs.bannerBgColor || '#FF6B00').replace(/"/g, '&quot;');
    const bannerFontColor = (cs.bannerFontColor || '#ffffff').replace(/"/g, '&quot;');
    
    const buttonText = (cs.buttonText || primaryBtn.text || 'TEXT US').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const buttonBgColor = (cs.buttonBgColor || '#ffffff').replace(/"/g, '&quot;');
    const buttonFontColor = (cs.buttonFontColor || '#222222').replace(/"/g, '&quot;');
    
    const iconColor = (cs.iconColor || '#FF6B00').replace(/"/g, '&quot;');
    const iconName = cs.icon || primaryBtn.icon || 'Phone';
    const iconSvg = getIcon(iconName) || icons[iconName] || icons.Phone;

    const sb = leadboxData.secondaryButton;
    let secondaryHtml = '';
    if (sb && sb.text) {
      const secondaryText = (sb.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const btnColor = (sb.buttonColor || '#FF6B00').replace(/"/g, '&quot;');
      const fontColor = (sb.fontColor || '#ffffff').replace(/"/g, '&quot;');
      const sbIconSvg = getIcon(sb.icon) || icons.Play;
      const iconHtml = sb.showIcon ? '<div style="display: flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; flex-shrink: 0; color: ' + fontColor + ';"><div style="display: flex; align-items: center; justify-content: center; transform: translateX(1px);">' + sbIconSvg + '</div></div>' : '';
      const clickHandler = sb.url ? 'onclick="window.open(' + JSON.stringify(sb.url) + ', \\\'_blank\\\')"' : '';

      secondaryHtml = '<div style="display: flex; justify-content: flex-end; margin-bottom: 0.75rem;"><button class="clearsky-secondary-button" style="background-color: ' + btnColor + '; color: ' + fontColor + ';" ' + clickHandler + '><span>' + secondaryText + '</span>' + iconHtml + '</button></div>';
    }

    if (leadboxData.primaryIconOnly) {
      return '<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.75rem;">' +
        secondaryHtml +
        '<button class="clearsky-toggle-button" style="background-color: ' + (buttonBgColor || '#FF6B00') + '; color: ' + (iconColor || '#ffffff') + '; border: 2px solid ' + (iconColor || '#ffffff') + ';" onclick="toggleLeadbox()">' + iconSvg + '</button>' +
        '</div>';
    } else {
      return '<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.75rem; margin-top: 1.5rem;">' +
        secondaryHtml +
        // The orange is one continuous shape: this wrapper carries the banner colour and
        // the pill sits flush in its bottom, with a matching 38px radius, so no seam can
        // open up between them. See the same construction in the builder preview.
        '<div style="display: flex; flex-direction: column; align-items: center; width: fit-content; min-width: max-content; overflow: hidden; background-color: ' + bannerBgColor + '; border-top-left-radius: 26px; border-top-right-radius: 26px; border-bottom-left-radius: 27px; border-bottom-right-radius: 27px; filter: drop-shadow(0 7px 14px rgba(0,0,0,0.12));">' +
        '<p style="color: ' + bannerFontColor + '; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; padding: 9px 22px 13px 22px; width: 100%; box-sizing: border-box; text-align: center; white-space: nowrap;">' + bannerText + '</p>' +
        '<button style="background-color: ' + buttonBgColor + '; height: 54px; width: 100%; border-radius: 9999px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding-left: 1.375rem; padding-right: 0.1875rem;" onclick="toggleLeadbox()">' +
        '<span style="font-size: 17px; font-weight: 800; letter-spacing: 0.14em; color: ' + buttonFontColor + '; white-space: nowrap; margin-right: 1rem;">' + buttonText + '</span>' +
        '<div style="width: 48px; height: 48px; border-radius: 9999px; background-color: ' + buttonBgColor + '; border: 2px solid ' + iconColor + '; color: ' + iconColor + '; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">' +
        '<div style="display: flex; align-items: center; justify-content: center;">' + iconSvg + '</div>' +
        '</div>' +
        '</button>' +
        '</div>' +
        '</div>';
    }
  }

  function toggleLeadbox() {
    const container = document.getElementById('clearsky-leadbox-' + leadboxId);
    const isOpen = container.querySelector('.clearsky-box');
    
    if (isOpen) {
      const content = container.firstElementChild;
      content.classList.add('clearsky-animate-out');
      
      setTimeout(() => {
        container.innerHTML = createClosedLeadbox();
      }, 300);
    } else {
      container.innerHTML = createOpenLeadbox();
      const content = container.querySelector('.clearsky-box');
      if (content) {
        content.classList.add('clearsky-animate-in');
      }
    }
  }

  function handleChannelClick(url, target, channelData) {
    // Handle navigation immediately to avoid popup blockers
    const isSpecialProtocol = url.startsWith('tel:') || url.startsWith('sms:') || url.startsWith('mailto:');
    if (isSpecialProtocol) {
      window.location.href = url;
    } else {
      window.open(url, target);
    }

    try {
      const messageData = {
        customer_name: "",
        customer_email: "",
        customer_phone: "",
        message: 'Channel clicked: ' + channelData.name + ' - ' + channelData.value,
        source: "leadbox",
        status: "new",
        thread_id: crypto.randomUUID(),
        source_url: window.location.href,
        company_id: companyId
      };

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);

      fetch(baseUrl + '/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageData),
        mode: 'cors',
        signal: controller.signal
      }).catch(err => {
        if (err.name !== 'AbortError') {
          console.error('Network error tracking click:', err);
        }
      });
    } catch (error) {
      console.error('Error in handleChannelClick:', error);
    }
  }

  function createLeadbox() {
    const container = document.createElement('div');
    container.id = 'clearsky-leadbox-' + leadboxId;
    container.className = 'clearsky-container';
    
    window.handleChannelClick = handleChannelClick;
    window.handleFormSubmit = handleFormSubmit;
    window.handleSubformSubmit = handleSubformSubmit;
    window.switchLeadboxView = switchLeadboxView;
    window.selectTimePill = selectTimePill;
    window.toggleLeadbox = toggleLeadbox;
    // Inline on* attributes are evaluated in GLOBAL scope, so every handler named in the
    // generated HTML has to be reachable from window — being defined inside this IIFE is
    // not enough. Omitting this left every SEND button permanently disabled.
    window.syncSubmitState = syncSubmitState;
    
    container.innerHTML = createClosedLeadbox();
    document.body.appendChild(container);
    addStyles();
  }
  
  createLeadbox();
  if (window.console) {
    console.log('[clearsky-leadbox] script loaded v2 (telemetry wired)', {
      fingerprintId: resolveFingerprint(),
      sessionId: sessionId,
      tenantSlug: companyId,
      leadboxId: leadboxId
    });
  }
})();`;
}
