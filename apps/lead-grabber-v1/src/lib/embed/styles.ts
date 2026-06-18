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
  height: 2.5rem;
  padding: 0.5rem 1.5rem;
  background: #3B5BDB;
  color: white;
  border-radius: 0.375rem;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
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
