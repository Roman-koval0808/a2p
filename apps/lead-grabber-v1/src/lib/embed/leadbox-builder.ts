import { leadboxStyles } from './styles';
import { icons } from './icons';

export interface LeadboxConfig {
	id: string;
	leadboxData: any;
	companyId: string;
	baseUrl: string;
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
  const icons = ${iconsJson};

  function getIcon(name) {
    return icons[name] || '';
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
        iconHtml = '<div style="display: flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; margin-right: 0.5rem;">' + channelIcon + '</div>';
      }
    }

    const buttonColor = (channel.buttonColor || '#3B5BDB').replace(/"/g, '&quot;');
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
    
    return '<button class="clearsky-button" type="button" style="background-color: ' + buttonColor + ';" onclick="' + escapedOnClick + '">' + iconHtml + channelValue + '</button>';
  }

  function createTextUsHtml() {
    return '<div class="clearsky-subform">' +
      '<div class="clearsky-subform-header">' +
      '<button type="button" class="clearsky-subform-back" onclick="switchLeadboxView(\\\'main\\\')">← Back</button>' +
      '<span class="clearsky-subform-title">Text Us</span>' +
      '</div>' +
      '<div class="clearsky-subform-card">' +
      '<form id="clearsky-textus-form" onsubmit="handleSubformSubmit(event, \\\'text_us\\\')" style="display: flex; flex-direction: column; gap: 0.875rem;">' +
      '<div class="clearsky-field-group"><label class="clearsky-field-label">Full Name</label><input type="text" name="name" class="clearsky-field-input" placeholder="Your Name" required /></div>' +
      '<div class="clearsky-field-group"><label class="clearsky-field-label">Mobile Number</label><input type="tel" name="mobile" class="clearsky-field-input" placeholder="Your Mobile Number" required /></div>' +
      '<div class="clearsky-field-group vertical"><label class="clearsky-field-label">Message</label><textarea name="message" class="clearsky-field-textarea" placeholder="How can we help?" required></textarea></div>' +
      '<p class="clearsky-subform-disclaimer">By submitting, you agree to receive informational text messages. Consent is optional & content may be automated. Msg/data rates apply.</p>' +
      '<button type="submit" class="clearsky-subform-submit">SEND</button>' +
      '</form>' +
      '</div>' +
      '<a class="clearsky-privacy-link">Privacy policy</a>' +
      '</div>';
  }

  function createRequestCallHtml() {
    return '<div class="clearsky-subform">' +
      '<div class="clearsky-subform-header">' +
      '<button type="button" class="clearsky-subform-back" onclick="switchLeadboxView(\\\'main\\\')">← Back</button>' +
      '<span class="clearsky-subform-title">Request a Call</span>' +
      '</div>' +
      '<div class="clearsky-subform-card">' +
      '<form id="clearsky-requestcall-form" onsubmit="handleSubformSubmit(event, \\\'request_call\\\')" style="display: flex; flex-direction: column; gap: 0.875rem;">' +
      '<div class="clearsky-field-group"><label class="clearsky-field-label">Full Name</label><input type="text" name="name" class="clearsky-field-input" placeholder="Your Name" required /></div>' +
      '<div class="clearsky-field-group"><label class="clearsky-field-label">Mobile Number</label><input type="tel" name="mobile" class="clearsky-field-input" placeholder="Your Mobile Number" required /></div>' +
      '<div class="clearsky-field-group vertical">' +
      '<label class="clearsky-field-label">Select preferred times</label>' +
      '<div class="clearsky-time-pills">' +
      '<input type="hidden" name="preferred_time" id="clearsky-preferred-time" value="ASAP" />' +
      '<button type="button" class="clearsky-time-pill active" onclick="selectTimePill(this, \\\'ASAP\\\')">ASAP</button>' +
      '<button type="button" class="clearsky-time-pill" onclick="selectTimePill(this, \\\'Morning\\\')">Morning</button>' +
      '<button type="button" class="clearsky-time-pill" onclick="selectTimePill(this, \\\'Afternoon\\\')">Afternoon</button>' +
      '</div>' +
      '</div>' +
      '<p class="clearsky-subform-disclaimer">By submitting, you agree to receive informational text messages. Consent is optional & content may be automated. Msg/data rates apply.</p>' +
      '<button type="submit" class="clearsky-subform-submit">SEND</button>' +
      '</form>' +
      '</div>' +
      '<a class="clearsky-privacy-link">Privacy policy</a>' +
      '</div>';
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
          form.innerHTML = '<div style="text-align: center; padding: 2rem; color: #EF4444;"><h3>Error</h3><p>There was an error submitting your request. Please try again.</p><button type="button" class="clearsky-button" style="margin-top: 1rem; background-color: #3B5BDB;" onclick="switchLeadboxView(\\\'main\\\')">Back</button></div>';
          return;
        }

        form.innerHTML = '<div style="text-align: center; padding: 2rem 1rem;"><div style="width: 48px; height: 48px; border-radius: 9999px; background-color: #DCFCE7; color: #16A34A; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem auto; font-size: 24px; font-weight: bold;">✓</div><h3 style="font-size: 1.25rem; font-weight: 700; color: #111827; margin: 0 0 0.5rem 0;">Thank you!</h3><p style="color: #6B7280; font-size: 0.875rem; margin: 0 0 1.5rem 0;">Your request has been received. We\\'ll be in touch shortly.</p><button type="button" class="clearsky-button" style="background-color: #3B5BDB;" onclick="switchLeadboxView(\\\'main\\\')">Done</button></div>';

      } catch (fetchError) {
        clearTimeout(timeoutId);
        form.innerHTML = '<div style="text-align: center; padding: 2rem; color: #EF4444;"><h3>Error</h3><p>There was an error submitting your request. Please try again.</p><button type="button" class="clearsky-button" style="margin-top: 1rem; background-color: #3B5BDB;" onclick="switchLeadboxView(\\\'main\\\')">Back</button></div>';
      }
    } catch (error) {
      console.error('Error in handleSubformSubmit:', error);
      form.innerHTML = '<div style="text-align: center; padding: 2rem; color: #EF4444;"><h3>Error</h3><p>There was an error submitting your request. Please try again.</p><button type="button" class="clearsky-button" style="margin-top: 1rem; background-color: #3B5BDB;" onclick="switchLeadboxView(\\\'main\\\')">Back</button></div>';
    }
  }

  function switchLeadboxView(view) {
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
    if (currentView === 'text_us') {
      bodyHtml = createTextUsHtml();
    } else if (currentView === 'request_call') {
      bodyHtml = createRequestCallHtml();
    } else if (leadboxData.textOnly) {
      bodyHtml = '<form id="clearsky-form" onsubmit="handleFormSubmit(event)" class="clearsky-form-fields"><input type="text" name="name" placeholder="Name" class="clearsky-input" required /><input type="tel" name="mobile" placeholder="Mobile Number" class="clearsky-input" required /><textarea name="message" placeholder="Message" class="clearsky-input" style="min-height: 100px;" required></textarea><div class="text-sm text-gray-500 mb-4 text-center">By submitting, you agree to receive text messages at this mobile number. Message & data rates apply.</div><button type="submit" class="clearsky-button" style="background-color: #3B5BDB;">Send Message</button></form>';
    } else {
      const buttonsHtml = (leadboxData.channels || []).map(channel => createChannelButton(channel)).join('');
      bodyHtml = '<div class="clearsky-buttons">' + buttonsHtml + '<a class="clearsky-privacy-link" style="margin-top: 0.25rem;">Privacy policy</a></div>';
    }

    function createSecondaryButton() {
      if (!leadboxData.secondaryButton || !leadboxData.secondaryButton.text) return '';
      const sb = leadboxData.secondaryButton;
      const secondaryText = (sb.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const btnColor = (sb.buttonColor || '#FF6B00').replace(/"/g, '&quot;');
      const fontColor = (sb.fontColor || '#ffffff').replace(/"/g, '&quot;');
      const iconSvg = getIcon(sb.icon) || icons.Play;
      const iconHtml = sb.showIcon ? '<div style="display: flex; align-items: center; justify-content: center; width: 2.25rem; height: 2.25rem; flex-shrink: 0; color: ' + fontColor + ';"><div style="display: flex; align-items: center; justify-content: center; transform: translateX(1px);">' + iconSvg + '</div></div>' : '';
      
      const clickHandler = sb.url ? 'onclick="window.open(' + JSON.stringify(sb.url) + ', \\\'_blank\\\')"' : '';

      return '<div style="display: flex; justify-content: flex-end; margin-bottom: 0.75rem;"><button class="clearsky-secondary-button" style="background-color: ' + btnColor + '; color: ' + fontColor + ';" ' + clickHandler + '><span>' + secondaryText + '</span>' + iconHtml + '</button></div>';
    }

    let logoUrl = leadboxData.logoImage || '';
    if (logoUrl.startsWith('/')) {
        // Remove trailing slash from baseUrl if present to avoid double slashes, though generally harmless in browsers
        const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        logoUrl = base + logoUrl;
    }
    const logoImg = logoUrl.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    
    const bannerBgColor = (leadboxData.topBanner?.backgroundColor || '#3B5BDB').replace(/"/g, '&quot;');
    const bannerFontColor = (leadboxData.topBanner?.fontColor || '#ffffff').replace(/"/g, '&quot;');
    const bannerFontFamily = (leadboxData.topBanner?.fontFamily || 'sans-serif').replace(/"/g, '&quot;');
    const bannerText = (leadboxData.topBanner?.text || 'Text with us.').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<div class="clearsky-box clearsky-animate-in"><div class="clearsky-header" style="background-color: ' + bannerBgColor + '; color: ' + bannerFontColor + '; font-family: ' + bannerFontFamily + ';"><button type="button" class="clearsky-close-btn" onclick="toggleLeadbox()">✕</button><p style="font-size: 0.875rem; font-weight: 800; line-height: 1.35; margin: 0; padding: 0 0.5rem;">' + bannerText + '</p><div class="clearsky-logo"><img src="' + logoImg + '" alt="Company Logo" /></div></div><div class="clearsky-content">' + bodyHtml + '</div></div>' + createClosedLeadbox();
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
      const iconHtml = sb.showIcon ? '<div style="display: flex; align-items: center; justify-content: center; width: 2.25rem; height: 2.25rem; flex-shrink: 0; color: ' + fontColor + ';"><div style="display: flex; align-items: center; justify-content: center; transform: translateX(1px);">' + sbIconSvg + '</div></div>' : '';
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
        '<div style="display: flex; flex-direction: column; align-items: center; width: fit-content; min-width: max-content; overflow: hidden; background-color: ' + bannerBgColor + '; border-top-left-radius: 36px; border-top-right-radius: 36px; border-bottom-left-radius: 38px; border-bottom-right-radius: 38px; filter: drop-shadow(0 10px 20px rgba(0,0,0,0.12));">' +
        '<p style="color: ' + bannerFontColor + '; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; padding: 12px 32px 16px 32px; width: 100%; box-sizing: border-box; text-align: center; white-space: nowrap;">' + bannerText + '</p>' +
        '<button style="background-color: ' + buttonBgColor + '; height: 76px; width: 100%; border-radius: 9999px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding-left: 2rem; padding-right: 0.25rem;" onclick="toggleLeadbox()">' +
        '<span style="font-size: 24px; font-weight: 800; letter-spacing: 0.18em; color: ' + buttonFontColor + '; white-space: nowrap; margin-right: 1.5rem;">' + buttonText + '</span>' +
        '<div style="width: 68px; height: 68px; border-radius: 9999px; background-color: ' + buttonBgColor + '; border: 2.5px solid ' + iconColor + '; color: ' + iconColor + '; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">' +
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
    
    container.innerHTML = createClosedLeadbox();
    document.body.appendChild(container);
    addStyles();
  }
  
  createLeadbox();
})();`;
}
