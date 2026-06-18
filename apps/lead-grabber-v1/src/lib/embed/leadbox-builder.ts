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

  function createMessageSquareIcon() {
    return icons.MessageSquare || '';
  }

  function createChannelIcon(iconName) {
    return getIcon(iconName);
  }

  function createChannelButton(channel) {
    const channelData = {name: channel.name, value: channel.value, url: channel.url};
    const iconHtml = channel.showIcon ? createChannelIcon(channel.icon) : '';
    const buttonColor = (channel.buttonColor || '#3B5BDB').replace(/"/g, '&quot;');
    const channelValue = (channel.value || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<button class="clearsky-button" type="button" style="background-color: ' + buttonColor + ';" onclick="handleChannelClick(' + JSON.stringify(channel.url) + ', ' + JSON.stringify(channel.target || '_blank') + ', ' + JSON.stringify(channelData) + ')">' + iconHtml + channelValue + '</button>';
  }

  async function handleFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
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

  function createOpenLeadbox() {
    let textOnlyHtml = '';
    if (leadboxData.textOnly) {
      textOnlyHtml = '<form id="clearsky-form" onsubmit="handleFormSubmit(event)" class="clearsky-form-fields"><input type="text" name="name" placeholder="Name" class="clearsky-input" required /><input type="tel" name="mobile" placeholder="Mobile Number" class="clearsky-input" required /><textarea name="message" placeholder="Message" class="clearsky-input" style="min-height: 100px;" required></textarea><div class="text-sm text-gray-500 mb-4 text-center">By submitting, you agree to receive text messages at this mobile number. Message & data rates apply.</div><button type="submit" class="clearsky-button" style="background-color: #3B5BDB;">Send Message</button></form>';
    } else {
      const buttonsHtml = (leadboxData.channels || []).map(channel => createChannelButton(channel)).join('');
      textOnlyHtml = '<div class="clearsky-buttons">' + buttonsHtml + '</div>';
    }

    let secondaryButtonHtml = '';
    if (leadboxData.secondaryButton) {
      const secondaryText = (leadboxData.secondaryButton.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      secondaryButtonHtml = '<div style="margin-top: 1rem; display: flex; justify-content: flex-end; gap: 0.5rem;"><button class="clearsky-secondary-button">' + secondaryText + (leadboxData.secondaryButton.showIcon ? createChannelIcon(leadboxData.secondaryButton.icon) : '') + '</button></div>';
    }

    let logoUrl = leadboxData.logoImage || '';
    if (logoUrl.startsWith('/')) {
        // Remove trailing slash from baseUrl if present to avoid double slashes, though generally harmless in browsers
        const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        logoUrl = base + logoUrl;
    }
    const logoImg = logoUrl.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    
    return '<div class="clearsky-box clearsky-animate-in"><div class="clearsky-header"><p style="font-size: 1.125rem;">Text with us.</p></div><div class="clearsky-content"><div class="clearsky-logo"><img src="' + logoImg + '" alt="Company Logo" class="w-[164px] h-[82px] object-contain absolute top-[-40px] z-10" /></div>' + textOnlyHtml + '<div class="clearsky-terms">Use subject to terms • Lead&Terms</div></div></div>' + secondaryButtonHtml + createClosedLeadbox();
  }

  function createClosedLeadbox() {
    if (leadboxData.primaryIconOnly) {
      return '<div style="margin-top: 1.75rem; display: flex; justify-content: flex-end; gap: 0.5rem;"><button class="clearsky-toggle-button" onclick="toggleLeadbox()">' + createMessageSquareIcon() + '</button></div>';
    } else {
      return '<div style="display: flex; flex-direction: column; align-items: center; position: relative; width:fit-content; float:right; margin-top:3rem"><div style="height: 3.5rem; position: absolute; top: -22px; width: 100%; border-radius: 1.5rem; z-index: 10; background-color: #3B5BDB; display: flex; justify-content: center;"><p style="color: white; font-size: 0.875rem; padding-left: 1rem; padding-right: 1rem; bottom:23px; position: absolute;">Questions?, just ask</p></div><button style="background-color: white; height: 3.5rem; padding-left: 5rem; padding-right: 5rem; z-index: 20; border-radius: 9999px; color: #3B5BDB; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 1.125rem; font-weight: 500; border: none; cursor: pointer;" onclick="toggleLeadbox()">TEXT US</button></div>';
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

  async function handleChannelClick(url, target, channelData) {
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
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(baseUrl + '/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messageData),
          mode: 'cors',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          console.error('Server error:', errorData?.error || response.status);
        }
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
          console.error('Request timed out');
        } else {
          console.error('Network error:', fetchError);
        }
      }

      window.open(url, target);
    } catch (error) {
      console.error('Error in handleChannelClick:', error);
      window.open(url, target);
    }
  }

  function createLeadbox() {
    const container = document.createElement('div');
    container.id = 'clearsky-leadbox-' + leadboxId;
    container.className = 'clearsky-container';
    
    window.handleChannelClick = handleChannelClick;
    window.handleFormSubmit = handleFormSubmit;
    window.toggleLeadbox = toggleLeadbox;
    
    container.innerHTML = createClosedLeadbox();
    document.body.appendChild(container);
    addStyles();
  }
  
  createLeadbox();
})();`;
}
