import { describe, it, expect } from 'vitest';
import { buildLeadboxScript } from '$lib/embed/leadbox-builder';

const script = buildLeadboxScript({
  id: 'lb_1',
  companyId: 'co_1',
  baseUrl: 'http://localhost:3005/',
  companyName: 'Total Trade Solutions',
  leadboxData: {
    logoImage: '/img/logo.png',
    topBanner: { text: 'Text with us. Message us now, book a demo, or start a free trial.', backgroundColor: '#E06A3B', fontColor: '#ffffff', fontFamily: 'sans-serif' },
    channels: [
      { name: 'Text', value: 'Text Us', type: 'text_us', buttonColor: '#4CAF50', icon: 'Smartphone', showIcon: true },
      { name: 'Call', value: 'Request a Call', type: 'request_call', buttonColor: '#E06A3B', icon: 'Phone', showIcon: true },
      { name: 'Demo', value: 'Watch a Demo Now', type: 'link', url: 'https://x.com', buttonColor: '#E06A3B', icon: 'PlayCircle', showIcon: true }
    ]
  }
});

describe('generated embed script', () => {
  it('is syntactically valid JavaScript', () => {
    expect(() => new Function(script)).not.toThrow();
  });
  it('carries the new structure', () => {
    expect(script).toContain('clearsky-header-lead');
    expect(script).toContain('clearsky-header-inline');
    expect(script).toContain('clearsky-subform-actions');
    expect(script).toContain('syncSubmitState');
    expect(script).toContain('Total Trade Solutions');
  });
  it('no longer renders the footer inside the grey body', () => {
    expect(script).not.toContain('<span>Use policy</span>');
  });

  it('carries only the privacy link in the footer', () => {
    expect(script).toContain('clearsky-privacy-link');
    expect(script).not.toContain('clearsky-usepolicy-link');
    expect(script).not.toContain('clearsky-footer-brand');
  });

  // A stray opening tag is valid JavaScript but broken HTML, so the syntax check above
  // cannot see it. This caught a duplicated <div class="clearsky-time-pills"> and an
  // onerror handler whose quotes terminated the surrounding string literal.
  it('emits balanced divs in every view', () => {
    const el = () => ({
      id: '',
      className: '',
      style: {},
      innerHTML: '',
      appendChild() {},
      setAttribute() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      classList: { add() {}, remove() {} }
    });
    const documentStub: any = {
      getElementById: () => null,
      createElement: el,
      querySelector: () => null,
      head: el(),
      body: el()
    };
    const windowStub: any = {};

    const body = script.replace('(function() {', '').replace(/\}\)\(\);?\s*$/, '');
    const fn = new Function(
      'document',
      'window',
      body +
        '; return { main: createOpenLeadbox, closed: createClosedLeadbox, textUs: createTextUsHtml, call: createRequestCallHtml };'
    );
    const api = fn(documentStub, windowStub) as Record<string, () => string>;

    for (const [name, render] of Object.entries(api)) {
      const html = render();
      const opens = (html.match(/<div\b/g) || []).length;
      const closes = (html.match(/<\/div>/g) || []).length;
      expect(`${name} ${opens}/${closes}`).toBe(`${name} ${opens}/${opens}`);
    }
  });
});

describe('header lead', () => {
  // The bold half must track whatever the admin typed rather than be a second field,
  // but a sentence whose only full stop is its last character has no lead to bold.
  const render = (text: string) => {
    const safe = String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const i = safe.indexOf('.');
    if (i === -1 || !safe.slice(i + 1).trim()) return safe;
    return '<span class="clearsky-header-lead">' + safe.slice(0, i + 1) + '</span>' + safe.slice(i + 1);
  };

  it('bolds the lead sentence only', () => {
    expect(render('Text with us. Message us now, book a demo, or start a free trial.')).toBe(
      '<span class="clearsky-header-lead">Text with us.</span> Message us now, book a demo, or start a free trial.'
    );
  });
  it('leaves a single-sentence header unbolded', () => {
    expect(render('Select times to get a call, & complete fields below.')).toBe(
      'Select times to get a call, & complete fields below.'
    );
  });
  it('bolds a header with no full stop at all', () => {
    expect(render('Text with us')).toBe('Text with us');
  });
});
