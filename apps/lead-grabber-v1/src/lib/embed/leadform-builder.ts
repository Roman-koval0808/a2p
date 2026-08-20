import { leadformStyles } from './styles';

export interface LeadformConfig {
	id: string;
	formData: any;
	companyId: string;
	baseUrl: string;
}

function escapeForJs(str: string): string {
	return JSON.stringify(str);
}

export function buildLeadformScript(config: LeadformConfig): string {
	const { id, formData, companyId, baseUrl } = config;

	const formDataJson = JSON.stringify(formData);
	const buttonColor = formData.settings?.buttonColor || '#3B5BDB';
	const stylesJson = JSON.stringify(leadformStyles.replace(/var\(--button-color\)/g, buttonColor));

	return `(function() {
  const formData = ${formDataJson};
  const companyId = ${escapeForJs(companyId)};
  const baseUrl = ${escapeForJs(baseUrl)};
  const formId = ${escapeForJs(id)};

  /* --- telemetry -----------------------------------------------------------
     Mirrors the a2p client + site client: same fingerprint resolution (?fp= →
     localStorage → CDN-free local fallback, persisted) so embed signals merge
     into the same visitor thread. Resolved lazily per signal so a fingerprint
     written by the marketing site's client after page load is picked up. */
  var sessionId = 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* Identity the visitor has given us in this session. Attached to every batch from the moment
     they submit, so the intake can layer it onto the profile the fingerprint already resolved
     instead of forking a second record for the same person. Mirrors the site client's
     identify(). */
  var identity = { name: null, email: null, phone: null };

  function identify(d) {
    if (!d) return;
    if (d.name) identity.name = d.name;
    if (d.email) identity.email = d.email;
    if (d.phone) identity.phone = d.phone;
  }

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

  /* Signals fired in the same synchronous block go out in ONE request. Two separate
     requests for the same visitor race each other in the intake's comm-log
     read-modify-write, and the loser's signal disappears from the thread. */
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
        name: identity.name,
        email: identity.email,
        phone: identity.phone,
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
      /* telemetry must never break the form */
    }
  }
  /* --- end telemetry ------------------------------------------------------- */

  function addStyles() {
    if (document.getElementById('clearsky-form-styles')) return;
    const style = document.createElement('style');
    style.id = 'clearsky-form-styles';
    style.textContent = ${stylesJson};
    document.head.appendChild(style);
  }

  function createFormElement(element) {
    if (element.type === 'text' || element.type === 'phone' || element.type === 'email') {
      return '<input type="' + (element.type === 'email' ? 'email' : 'text') + '" name="' + element.id + '" placeholder="' + (element.label || '') + '" class="clearsky-input" ' + (element.required ? 'required' : '') + ' />';
    } else if (element.type === 'message' || element.type === 'address') {
      return '<textarea name="' + element.id + '" placeholder="' + (element.label || '') + '" class="clearsky-input" style="min-height: 100px;" ' + (element.required ? 'required' : '') + '></textarea>';
    } else if (element.type === 'multiselect') {
      const options = (element.options || []).map(option => 
        '<label class="flex items-center gap-2 mb-2"><input type="checkbox" name="' + element.id + '[]" value="' + option.replace(/"/g, '&quot;') + '"><span>' + option + '</span></label>'
      ).join('');
      return '<div><label class="block mb-2 text-sm font-medium">' + element.label + '</label>' + options + '</div>';
    } else if (element.type === 'dropdown') {
      const options = (element.options || []).map(option => 
        '<option value="' + option.replace(/"/g, '&quot;') + '">' + option + '</option>'
      ).join('');
      return '<select name="' + element.id + '" class="clearsky-input" ' + (element.required ? 'required' : '') + '><option value="">' + element.label + '</option>' + options + '</select>';
    }
    return '';
  }

  function createForm() {
    const container = document.createElement('div');
    container.id = 'clearsky-form-' + formId;
    container.className = 'clearsky-form';
    
    const heading = formData.settings?.heading || 'Contact Us';
    const intro = formData.settings?.intro || '';
    const buttonText = formData.settings?.buttonText || 'Submit';
    const buttonColor = formData.settings?.buttonColor || '#3B5BDB';
    
    const privacyLink = formData.settings?.privacyPolicy?.type === 'custom' && formData.settings?.privacyPolicy?.link
      ? formData.settings.privacyPolicy.link
      : '/privacy';
    
    const formElementsHtml = (formData.formElements || []).map(element => createFormElement(element)).join('');
    
    const formHtml = '<h2>' + heading.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</h2>' +
      (intro ? '<p>' + intro.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>' : '') +
      '<form id="clearsky-form" onsubmit="handleSubmit(event)" class="clearsky-form-fields">' +
      formElementsHtml +
      '<div class="text-sm text-gray-500 mb-4 text-center">By submitting, you agree to receive text messages at this mobile number. Message & data rates apply. See our <a href="' + privacyLink + '" class="text-primary hover:underline" target="_blank">privacy policy</a></div>' +
      '<button type="submit" class="clearsky-button" style="background-color: ' + buttonColor + ';">' + buttonText + '</button>' +
      '</form>';
    
    container.innerHTML = formHtml;
    const script = document.currentScript;
    if (script && script.parentNode) {
      script.parentNode.insertBefore(container, script);
    } else {
      document.body.appendChild(container);
    }
    addStyles();

    trackSignal('lg_open', { url: window.location.href });

    var focusFired = {};
    container.addEventListener('focusin', function (e) {
      var el = e.target;
      if (!el || !el.name) return;
      var signal = null;
      if (el.name === 'name') signal = 'form_name_focus';
      else if (el.name === 'email' || el.getAttribute('type') === 'email') signal = 'form_email_focus';
      else if (el.name === 'phone' || el.getAttribute('type') === 'phone') signal = 'form_phone_focus';
      if (signal && !focusFired[el.name]) {
        focusFired[el.name] = true;
        trackSignal(signal);
      }
    }, true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.7';
      submitBtn.textContent = 'Submitting...';
      submitBtn.style.cursor = 'not-allowed';
    }

    const formDataObj = new FormData(form);
    const data = Object.fromEntries(formDataObj);

    /* Identify BEFORE the signals fire so the submit batch itself carries the identity and the
       intake can promote the fingerprint's existing profile in place. */
    identify({ name: data.name, email: data.email, phone: data.phone });
    trackSignals([{ name: 'lg_submit' }, { name: 'form_submit' }]);

    try {
      const initials = data.name ? data.name.split(' ').map(n => n[0]).join('').toUpperCase() : '??';
      const messageContent = data.message || '';
      const normalizedPhone = data.phone ? data.phone.replace(/[^+\\d]/g, '') : "";

      const messageData = {
        customer_name: data.name || "Anonymous",
        customer_email: data.email || "",
        customer_phone: data.phone || "",
        message: messageContent,
        source: "leadform",
        status: "new",
        thread_id: normalizedPhone || crypto.randomUUID(),
        source_url: window.location.href,
        company_id: companyId,
        created: new Date().toISOString(),
        initials: initials,
        color: "bg-primary",
        fingerprint: resolveFingerprint()
      };

      console.log('Sending message data:', messageData);

      const apiBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const response = await fetch(apiBase + '/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Server error:', errorData);
        throw new Error('Failed to send message: ' + (errorData.message || response.statusText));
      }

      if (formData.settings?.customConfirmation?.type === "custom" && formData.settings?.customConfirmation?.link) {
        window.location.href = formData.settings.customConfirmation.link;
      } else {
        form.innerHTML = '<div style="text-align: center; padding: 2rem;"><h3>Thank you!</h3><p>Your submission has been received.</p></div>';
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      form.innerHTML = '<div style="text-align: center; padding: 2rem; color: #EF4444;"><h3>Error</h3><p>There was an error submitting your form. Please try again.</p></div>';
    }
  }

  window.handleSubmit = handleSubmit;
  createForm();
  if (window.console) {
    console.log('[clearsky-leadform] script loaded v2 (telemetry wired)', {
      fingerprintId: resolveFingerprint(),
      sessionId: sessionId,
      tenantSlug: companyId,
      formId: formId
    });
  }
})();`;
}
