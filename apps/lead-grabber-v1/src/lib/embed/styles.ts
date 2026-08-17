export const leadboxStyles = `
.clearsky-leadbox {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.clearsky-container {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: 9999;
}

/* ---------------------------------------------------------------- panel -- */
.clearsky-box {
  overflow: hidden;
  position: relative;
  width: 368px;
  max-width: calc(100vw - 2rem);
  margin: 0 auto;
  background: #f1f2f4;
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0,0,0,0.22);
}

/* --------------------------------------------------------------- header -- */
.clearsky-header {
  background: #3B5BDB;
  color: #ffffff;
  padding: 1.375rem 2.75rem 0 2.75rem;
  position: relative;
  box-sizing: border-box;
}
.clearsky-header-text {
  font-size: 1.0625rem;
  font-weight: 400;
  line-height: 1.45;
  margin: 0;
  text-align: center;
}
.clearsky-header-inline .clearsky-header-text { text-align: left; }
/* "Text with us." leads in bold, the rest reads as a sentence — one paragraph,
   two weights, as in the reference. */
.clearsky-header-lead {
  font-weight: 700;
}
/* The logo sits astride the header/body seam, so the header reserves half of it. */
.clearsky-header-spacer {
  height: 62px;
}

/* Request-a-call puts the logo inline to the left of the text instead of
   centred on the seam, which leaves the card room for the extra field. */
.clearsky-header.clearsky-header-inline {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.375rem 3rem 1.375rem 3.25rem;
}
.clearsky-header-inline .clearsky-header-spacer { display: none; }
.clearsky-header-inline .clearsky-logo {
  position: static;
  transform: none;
  width: 62px;
  height: 62px;
  flex-shrink: 0;
  box-shadow: none;
}

.clearsky-close-btn,
.clearsky-back-btn {
  position: absolute;
  top: 1.125rem;
  background: none;
  border: none;
  color: rgba(255,255,255,0.9);
  font-size: 1.375rem;
  font-weight: 400;
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
  transition: color 0.15s, transform 0.15s;
  font-family: inherit;
}
.clearsky-close-btn { right: 1rem; }
.clearsky-back-btn  { left: 1rem; }
.clearsky-header-inline .clearsky-back-btn { top: 50%; transform: translateY(-50%); }
.clearsky-close-btn:hover,
.clearsky-back-btn:hover { color: #ffffff; }

/* ----------------------------------------------------------------- logo -- */
.clearsky-logo {
  position: absolute;
  bottom: -58px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  width: 116px;
  height: 116px;
  border-radius: 9999px;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 14px;
}
.clearsky-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

/* ----------------------------------------------------------------- body -- */
.clearsky-content {
  padding: 4.25rem 1.125rem 1.25rem 1.125rem;
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
  background: #f1f2f4;
  box-sizing: border-box;
}
/* The inline-logo header does not overhang, so the body needs no clearance. */
.clearsky-content.clearsky-content-inline {
  padding-top: 1.125rem;
}

/* ------------------------------------------------------- channel buttons -- */
.clearsky-buttons {
  background: #ffffff;
  border-radius: 12px;
  padding: 1.25rem 1.125rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.clearsky-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  white-space: nowrap;
  font-size: 0.9375rem;
  font-weight: 700;
  letter-spacing: 0.045em;
  text-transform: uppercase;
  height: 2.75rem;
  padding: 0 1.25rem;
  width: 100%;
  border-radius: 9999px;
  color: #ffffff;
  border: none;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  box-shadow: 0 3px 8px rgba(0,0,0,0.14);
  font-family: inherit;
  box-sizing: border-box;
}
.clearsky-button:hover { opacity: 0.93; transform: translateY(-1px); }
.clearsky-button:active { transform: translateY(0); }
.clearsky-button:focus-visible { outline: 2px solid #ffffff; outline-offset: -4px; }
.clearsky-button:disabled { pointer-events: none; opacity: 0.5; }
.clearsky-button svg { width: 1.125rem; height: 1.125rem; }

/* --------------------------------------------------------------- footer -- */
/* A white bar across the full width of the panel, outside the grey body. */
/* The Figma footer carries the privacy link alone — no use-policy, no brand. */
.clearsky-footer-links {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8125rem;
  color: #8b8f96;
  background: #ffffff;
  padding: 0.875rem 1rem;
  white-space: nowrap;
}
.clearsky-privacy-link {
  color: #8b8f96;
  text-decoration: none;
  cursor: pointer;
}
.clearsky-privacy-link:hover { color: #5d6169; text-decoration: underline; }

/* -------------------------------------------------------------- subform -- */
.clearsky-subform-card {
  background: #ffffff;
  border-radius: 12px;
  padding: 1.125rem 1.125rem 1.375rem 1.125rem;
}
/* Label on the left, value on the right, sharing one underlined row. */
.clearsky-field-row {
  border-bottom: 1px solid #dcdfe4;
  padding: 0.75rem 0 0.625rem 0;
  display: flex;
  align-items: baseline;
  gap: 0.875rem;
}
.clearsky-field-row:last-of-type { border-bottom: none; }
.clearsky-field-label {
  flex-shrink: 0;
  font-size: 0.9375rem;
  font-weight: 400;
  color: #8b8f96;
}
/* Message is taller, so its label sits above the box rather than beside it. */
.clearsky-field-row.clearsky-field-stacked {
  display: block;
}
.clearsky-field-stacked .clearsky-field-label { display: block; margin-bottom: 0.25rem; }
.clearsky-field-stacked .clearsky-field-textarea { padding-left: 0.75rem; }
.clearsky-field-input,
.clearsky-field-textarea {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  border: none;
  background: transparent;
  padding: 0.125rem 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #1f2328;
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
}
.clearsky-field-textarea { resize: none; min-height: 62px; }
.clearsky-field-input::placeholder,
.clearsky-field-textarea::placeholder { color: #6c7078; font-weight: 400; }

.clearsky-field-times { padding: 1rem 0 0.25rem 0; }
.clearsky-times-label {
  display: block;
  font-size: 0.9375rem;
  font-weight: 400;
  color: #1f2328;
  margin-bottom: 0.75rem;
}
/* Sized to fit all three on one row inside the card at the panel's 368px. */
.clearsky-time-pills { display: flex; flex-wrap: nowrap; gap: 0.5rem; }
/* Outlined, content-width pills — filled only once chosen. */
.clearsky-time-pill {
  padding: 0.4375rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  border: 1.5px solid #E06A3B;
  background: #ffffff;
  color: #1f2328;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  line-height: 1.2;
}
.clearsky-time-pill:hover { background: #fdf3ee; }
.clearsky-time-pill.active {
  background: #E06A3B;
  border-color: #E06A3B;
  color: #ffffff;
}

/* The disclaimer sits on the grey, BELOW the white card — not inside it. */
.clearsky-subform-disclaimer {
  font-size: 0.75rem;
  color: #6c7078;
  text-align: center;
  line-height: 1.45;
  margin: 0.875rem 0.25rem 0 0.25rem;
}

/* A centred pill, sized to its label — not a full-width bar. */
.clearsky-subform-actions {
  display: flex;
  justify-content: center;
  margin: 1.125rem 0 0.25rem 0;
}
.clearsky-subform-submit {
  min-width: 148px;
  padding: 0.8125rem 1.75rem;
  border-radius: 8px;
  background-color: #E84C22;
  color: #ffffff;
  font-size: 1rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: none;
  cursor: pointer;
  transition: opacity 0.2s, background-color 0.2s;
  font-family: inherit;
}
.clearsky-subform-submit:hover { opacity: 0.93; }
/* Pale until the form is fillable, as in the reference. */
.clearsky-subform-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ------------------------------------------------------- closed / misc. -- */
.clearsky-cancel-fab {
  width: 46px;
  height: 46px;
  border-radius: 9999px;
  border: none;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 20px rgba(0,0,0,0.22);
  cursor: pointer;
  transition: transform 0.15s, opacity 0.15s;
}
.clearsky-cancel-fab:hover { transform: scale(1.06); opacity: 0.95; }
.clearsky-cancel-fab:active { transform: scale(0.95); }
.clearsky-secondary-button {
  height: 2.75rem;
  padding: 0 1.125rem 0 1.375rem;
  background: #FF6B00;
  color: white;
  border-radius: 9999px;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.9375rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  transition: opacity 0.2s, transform 0.1s;
}
.clearsky-secondary-button:hover { opacity: 0.95; }
.clearsky-secondary-button:active { transform: scale(0.98); }
.clearsky-toggle-button {
  height: 2.875rem;
  width: 2.875rem;
  border-radius: 9999px;
  background: #3B5BDB;
  color: white;
  border: none;
  padding: 0.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}
.clearsky-animate-in { animation: clearsky-slide-in 0.3s ease-out; }
.clearsky-animate-out { animation: clearsky-slide-out 0.3s ease-out; }
@keyframes clearsky-slide-in {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes clearsky-slide-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(20px); }
}
.clearsky-form-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}
.clearsky-input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #E5E7EB;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  background-color: white;
}
.clearsky-input:focus { outline: 2px solid #3B5BDB; outline-offset: 2px; }
`;

export const leadformStyles = `
.clearsky-form {
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 32rem;
  margin: 0 auto;
  padding: 1.5rem;
}
.clearsky-form h2 {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}
.clearsky-form p {
  color: #6B7280;
  margin-bottom: 1.5rem;
}
.clearsky-form-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.clearsky-input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #E5E7EB;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}
.clearsky-input:focus {
  outline: 2px solid var(--button-color);
  outline-offset: 2px;
}
.clearsky-button {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--button-color);
  color: white;
  border: none;
  border-radius: 0.375rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}
.clearsky-button:hover {
  opacity: 0.9;
}
.clearsky-terms {
  margin-top: 1rem;
  text-align: center;
  font-size: 0.75rem;
  color: #6B7280;
}
`;
