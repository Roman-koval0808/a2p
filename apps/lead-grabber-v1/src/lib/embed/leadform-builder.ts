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
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formDataObj = new FormData(form);
    const data = Object.fromEntries(formDataObj);

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
        color: "bg-primary"
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
})();`;
}
