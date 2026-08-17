export const leadboxStyles = `
.clearsky-leadbox {
  font-family: system-ui, -apple-system, sans-serif;
}
.clearsky-container {
  font-family: system-ui, -apple-system, sans-serif;
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: 9999;
}
.clearsky-box {
  border: 1px solid #e5e7eb;
  overflow: hidden;
  position: relative;
  width: 517px;
  margin: 0 auto;
  background: #ffffff;
}
.clearsky-header {
  background: #3B5BDB;
  color: white;
  padding: 1rem;
  height: 7rem;
  display: flex;
  align-items: center;
}
.clearsky-content {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  position: relative;
}
.clearsky-logo {
  display: flex;
  justify-content: center;
  margin-bottom: 1rem;
  position: relative;
}
.clearsky-logo img {
  width: 164px;
  height: 82px;
  object-fit: contain;
  position: absolute;
  top: -40px;
  z-index: 10;
}
.clearsky-buttons {
  margin-top: 3rem;
  padding: 0 1.25rem;
  background: white;
  padding-top: 1rem;
  padding-bottom: 5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.clearsky-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  white-space: nowrap;
  font-size: 0.875rem;
  font-weight: 600;
  height: 2.5rem;
  padding: 0 1rem;
  width: 100%;
  border-radius: 9999px;
  color: white;
  border: none;
  cursor: pointer;
  transition: opacity 0.2s;
}
.clearsky-button:hover {
  opacity: 0.9;
}
.clearsky-button:focus-visible {
  outline: 2px solid #3B5BDB;
  outline-offset: 2px;
}
.clearsky-button:disabled {
  pointer-events: none;
  opacity: 0.5;
}
.clearsky-secondary-button {
  height: 3.5rem;
  padding: 0 1.75rem 0 2rem;
  background: #FF6B00;
  color: white;
  border-radius: 9999px;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  box-shadow: 0 4px 15px rgba(0,0,0,0.12);
  transition: opacity 0.2s, transform 0.1s;
}
.clearsky-secondary-button:hover {
  opacity: 0.95;
}
.clearsky-secondary-button:active {
  transform: scale(0.98);
}
.clearsky-toggle-button {
  height: 3.5rem;
  width: 3.5rem;
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
.clearsky-terms {
  text-align: center;
  font-size: 0.75rem;
  color: #6B7280;
}
.clearsky-animate-in {
  animation: clearsky-slide-in 0.3s ease-out;
}
.clearsky-animate-out {
  animation: clearsky-slide-out 0.3s ease-out;
}
@keyframes clearsky-slide-in {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes clearsky-slide-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(20px);
  }
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
.clearsky-input:focus {
  outline: 2px solid #3B5BDB;
  outline-offset: 2px;
}
.clearsky-subform {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: 0 1.25rem 2rem 1.25rem;
  background: white;
}
.clearsky-subform-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #E5E7EB;
  padding-bottom: 0.5rem;
  margin-bottom: 0.25rem;
}
.clearsky-subform-back {
  background: none;
  border: none;
  color: #6B7280;
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0;
  font-family: inherit;
}
.clearsky-subform-back:hover {
  color: #111827;
}
.clearsky-subform-title {
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  color: #3B5BDB;
  letter-spacing: 0.05em;
}
.clearsky-field-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  border-bottom: 1px solid #E5E7EB;
  padding-bottom: 0.25rem;
}
.clearsky-field-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #6B7280;
}
.clearsky-field-input {
  width: 100%;
  border: none;
  background: transparent;
  padding: 0.25rem 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: #111827;
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
}
.clearsky-field-textarea {
  width: 100%;
  border: none;
  background: transparent;
  padding: 0.25rem 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: #111827;
  outline: none;
  font-family: inherit;
  resize: none;
  min-height: 48px;
  box-sizing: border-box;
}
.clearsky-time-pills {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
.clearsky-time-pill {
  flex: 1;
  padding: 0.5rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 700;
  border: 1px solid #D1D5DB;
  background: white;
  color: #4B5563;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
  font-family: inherit;
}
.clearsky-time-pill:hover {
  border-color: #9CA3AF;
}
.clearsky-time-pill.active {
  border-color: #FF6B00;
  color: #FF6B00;
  background: #FFF7ED;
}
.clearsky-subform-submit {
  width: 100%;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background-color: #E84C22;
  color: white;
  font-size: 0.9375rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  transition: opacity 0.2s;
  font-family: inherit;
}
.clearsky-subform-submit:hover {
  opacity: 0.95;
}
.clearsky-subform-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.clearsky-subform-disclaimer {
  font-size: 0.6875rem;
  color: #9CA3AF;
  text-align: center;
  line-height: 1.3;
  margin: 0;
}
.clearsky-privacy-link {
  display: block;
  text-align: center;
  font-size: 0.6875rem;
  color: #9CA3AF;
  text-decoration: underline;
  cursor: pointer;
}
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
