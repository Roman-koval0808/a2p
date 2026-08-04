import { describe, it, expect } from 'vitest';
import { deriveNextActionPlan, resolveNextActionOwner, timeframeToDays } from './next-action';
import type { MessageIntent } from './message-intent';

/** Rory's email — the case this module exists for. */
const rory: Partial<MessageIntent> = {
	intent_bucket: 'sales',
	purpose: 'opportunity',
	urgency: 'low',
	wants_callback: false,
	wants_appointment: false,
	wants_meeting: true,
	customer_will_initiate: true,
	customer_initiate_method: 'call',
	customer_initiate_exact_datetime: null,
	customer_initiate_timeframe: 'a couple of weeks',
	customer_initiate_timeframe_days: 14,
	has_enough_info_to_quote: false,
	missing_info_for_quote: ['home square footage', 'existing system'],
	next_action_owner: 'customer',
	reason: 'Prospect wants central air conditioning pricing but gave no specifications.',
	action_items: ['Prepare a quote for a central air conditioning unit for Rory', 'Call Rory back to discuss options']
};

describe('timeframeToDays', () => {
	it('prefers the number the model resolved', () => {
		expect(timeframeToDays({ customer_initiate_timeframe_days: 14 })).toBe(14);
	});

	it('reads a verbatim window when no number was given', () => {
		expect(timeframeToDays({ customer_initiate_timeframe: 'a couple of weeks' })).toBe(14);
		expect(timeframeToDays({ customer_initiate_timeframe: 'a few days' })).toBe(3);
		expect(timeframeToDays({ customer_initiate_timeframe: 'next month' })).toBe(30);
	});

	it('does not read "a couple of weeks" as one week', () => {
		expect(timeframeToDays({ customer_initiate_timeframe: 'a couple of weeks' })).not.toBe(7);
	});

	it('parses an explicit count', () => {
		expect(timeframeToDays({ customer_initiate_timeframe: 'in 10 days' })).toBe(10);
		expect(timeframeToDays({ customer_initiate_timeframe: '3 weeks or so' })).toBe(21);
	});

	it('returns null when the customer named no window', () => {
		expect(timeframeToDays({})).toBeNull();
		expect(timeframeToDays({ customer_initiate_timeframe: 'sometime' })).toBeNull();
	});
});

describe('resolveNextActionOwner', () => {
	it('uses the model answer when present', () => {
		expect(resolveNextActionOwner({ next_action_owner: 'customer' })).toBe('customer');
	});

	it('derives customer ownership from the booleans otherwise', () => {
		expect(resolveNextActionOwner({ customer_will_initiate: true, wants_callback: false })).toBe('customer');
	});

	it('leaves it with the business when they asked us to call', () => {
		expect(resolveNextActionOwner({ customer_will_initiate: true, wants_callback: true })).toBe('business');
		expect(resolveNextActionOwner({})).toBe('business');
	});
});

describe('deriveNextActionPlan', () => {
	it('replaces a premature quote task with an intake', () => {
		const plan = deriveNextActionPlan(rory, 'Rory');
		expect(plan.intakeRequired).toBe(true);
		expect(plan.tasks.some((t) => /prepare a quote/i.test(t))).toBe(false);
		expect(plan.tasks.some((t) => /intake/i.test(t))).toBe(true);
		expect(plan.dropped.some((d) => /Prepare a quote/i.test(d.task))).toBe(true);
	});

	it('does not add a second intake when the model already proposed one', () => {
		const plan = deriveNextActionPlan(
			{ ...rory, action_items: ['Schedule a customer intake to scope the central air job before pricing'] },
			'Rory'
		);
		expect(plan.tasks.filter((t) => /intake/i.test(t))).toHaveLength(1);
		expect(plan.tasks).toContain('Schedule a customer intake to scope the central air job before pricing');
	});

	it('names what we would have to ask before pricing', () => {
		const plan = deriveNextActionPlan(rory, 'Rory');
		const intake = plan.tasks.find((t) => /intake/i.test(t))!;
		expect(intake).toMatch(/home square footage/);
	});

	it('does not chase a customer who said they would call us', () => {
		const plan = deriveNextActionPlan(rory, 'Rory');
		expect(plan.owner).toBe('customer');
		expect(plan.tasks.some((t) => /call rory back/i.test(t))).toBe(false);
		expect(plan.tasks.some((t) => /hold for rory/i.test(t))).toBe(true);
	});

	it('sets a suspense check past the window the customer named', () => {
		const now = new Date('2026-08-04T12:00:00Z');
		const plan = deriveNextActionPlan(rory, 'Rory', now);
		expect(plan.suspense).not.toBeNull();
		expect(plan.suspense!.timeframeDays).toBe(14);
		// 14 days promised + 2 days grace
		expect(plan.suspense!.dueAt.toISOString()).toBe('2026-08-20T12:00:00.000Z');
		expect(plan.suspense!.description).toMatch(/no contact since/i);
	});

	it('defaults the window when the customer promised to return but named no date', () => {
		const plan = deriveNextActionPlan(
			{ ...rory, customer_initiate_timeframe: null, customer_initiate_timeframe_days: null },
			'Rory'
		);
		expect(plan.suspense!.timeframeDays).toBe(14);
	});

	it('keeps the business on the hook when the customer asked for a callback', () => {
		const plan = deriveNextActionPlan(
			{
				intent_bucket: 'follow_up',
				purpose: 'support',
				wants_callback: true,
				customer_will_initiate: false,
				next_action_owner: 'business',
				has_enough_info_to_quote: true,
				action_items: ['Call the customer back tomorrow morning about the furnace noise']
			},
			'Sam'
		);
		expect(plan.owner).toBe('business');
		expect(plan.suspense).toBeNull();
		expect(plan.tasks).toEqual(['Call the customer back tomorrow morning about the furnace noise']);
	});

	it('never puts an emergency into a wait state', () => {
		const plan = deriveNextActionPlan(
			{
				purpose: 'emergency',
				urgency: 'critical',
				customer_will_initiate: true,
				next_action_owner: 'customer',
				has_enough_info_to_quote: true,
				action_items: ['Dispatch a technician immediately']
			},
			'Dana'
		);
		expect(plan.owner).toBe('business');
		expect(plan.suspense).toBeNull();
		expect(plan.tasks).toEqual(['Dispatch a technician immediately']);
	});

	it('leaves a quotable job alone', () => {
		const plan = deriveNextActionPlan(
			{
				purpose: 'opportunity',
				intent_bucket: 'sales',
				has_enough_info_to_quote: true,
				next_action_owner: 'business',
				action_items: ['Prepare a quote for the 1,800 sq ft ducted retrofit discussed']
			},
			'Alex'
		);
		expect(plan.intakeRequired).toBe(false);
		expect(plan.tasks).toEqual(['Prepare a quote for the 1,800 sq ft ducted retrofit discussed']);
	});

	it('always produces at least one task', () => {
		const plan = deriveNextActionPlan({ action_items: [] }, 'Jo');
		expect(plan.tasks.length).toBeGreaterThan(0);
	});

	it('survives a missing intent', () => {
		const plan = deriveNextActionPlan(null, 'Jo');
		expect(plan.owner).toBe('business');
		expect(plan.tasks).toEqual(['Review and follow up with Jo']);
	});
});
