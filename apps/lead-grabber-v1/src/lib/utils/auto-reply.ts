export interface BusinessHoursDay {
	isOpen: boolean;
	hours: string | null;
}

export type BusinessHoursConfig = Record<string, BusinessHoursDay>;

export interface AutoReplySettings {
	textAutoReply: boolean;
	businessHoursMessage: string;
	afterHoursMessage: string;
	leadformBusinessHoursMessage: string;
	leadformAfterHoursMessage: string;
	businessHours: BusinessHoursConfig;
}

export function isBusinessHours(currentHour: number, businessHours: BusinessHoursConfig) {
	// Get current day name in lowercase
	const day = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
	const daySettings = businessHours?.[day];

	// If the day is marked as closed (not open or no hours), return false
	if (!daySettings?.isOpen || !daySettings.hours) {
		return {
			isOpen: false,
			isClosed: true // Explicitly indicate it's a closed day
		};
	}

	const now = new Date();
	const currentMinutes = now.getHours() * 60 + now.getMinutes();

	const [start, end] = daySettings.hours.split(' - ').map((time) => {
		const [timePart, period] = time.trim().split(' ');
		const [h, m = '0'] = timePart.split(':');
		let hour24 = parseInt(h);
		const minutes = parseInt(m);

		// Convert to 24-hour format
		if (period === 'PM' && hour24 !== 12) {
			hour24 += 12;
		} else if (period === 'AM' && hour24 === 12) {
			hour24 = 0;
		}

		return hour24 * 60 + minutes; // Convert to minutes since midnight
	});

	return {
		isOpen: currentMinutes >= start && currentMinutes < end,
		isClosed: false
	};
}

/**
 * Calculate the next business day when the company will be available
 * Returns a formatted date string
 * This function is called when outside business hours, so it finds the next available business day
 */
export function getNextBusinessDay(businessHours: BusinessHoursConfig): string {
	const now = new Date();
	const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
	const currentMinutes = now.getHours() * 60 + now.getMinutes();

	// Check if today is a business day
	const todayIndex = now.getDay();
	const todayName = dayNames[todayIndex];
	const todaySettings = businessHours?.[todayName];

	// If today is a business day, check if we're before business hours
	if (todaySettings?.isOpen && todaySettings?.hours) {
		const [start] = todaySettings.hours.split(' - ').map((time) => {
			const [timePart, period] = time.trim().split(' ');
			const [h, m = '0'] = timePart.split(':');
			let hour24 = parseInt(h);
			const minutes = parseInt(m);

			if (period === 'PM' && hour24 !== 12) {
				hour24 += 12;
			} else if (period === 'AM' && hour24 === 12) {
				hour24 = 0;
			}

			return hour24 * 60 + minutes;
		});

		// If we're before business hours today, return today
		if (currentMinutes < start) {
			const options: Intl.DateTimeFormatOptions = {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			};
			return now.toLocaleDateString('en-US', options);
		}
	}

	// Otherwise, start checking from tomorrow
	let checkDate = new Date(now);
	checkDate.setDate(checkDate.getDate() + 1);

	// Look up to 7 days ahead to find the next business day
	for (let i = 0; i < 7; i++) {
		const dayIndex = checkDate.getDay();
		const dayName = dayNames[dayIndex];
		const daySettings = businessHours?.[dayName];

		if (daySettings?.isOpen && daySettings?.hours) {
			// Format the date nicely
			const options: Intl.DateTimeFormatOptions = {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			};
			return checkDate.toLocaleDateString('en-US', options);
		}

		// Move to next day
		checkDate.setDate(checkDate.getDate() + 1);
	}

	// Fallback: if no business day found in 7 days, return a generic message
	return 'the next business day';
}

export function getAutoReplyMessage(
	source: string,
	autoReplySettings: AutoReplySettings,
	currentHour: number
): string | null {
	if (!autoReplySettings?.textAutoReply || !autoReplySettings?.businessHours) {
		return null;
	}

	try {
		const hours = isBusinessHours(currentHour, autoReplySettings.businessHours);
		let message: string;

		if (source === 'leadform') {
			if (hours.isClosed || !hours.isOpen) {
				message = autoReplySettings.leadformAfterHoursMessage;
			} else {
				message = autoReplySettings.leadformBusinessHoursMessage;
			}
		} else {
			if (hours.isClosed || !hours.isOpen) {
				message = autoReplySettings.afterHoursMessage;
			} else {
				message = autoReplySettings.businessHoursMessage;
			}
		}

		// Replace {date} placeholder with the next business day if present
		if (message.includes('{date}')) {
			const nextBusinessDay = getNextBusinessDay(autoReplySettings.businessHours);
			message = message.replace(/{date}/g, nextBusinessDay);
		}

		return message;
	} catch (error) {
		console.error('Error in getAutoReplyMessage:', error);
		return null;
	}
}

export function getDefaultAutoReplySettings(): AutoReplySettings {
	return {
		textAutoReply: false,
		businessHoursMessage: 'Hello, thank you for messaging us. Our team will respond shortly.',
		afterHoursMessage:
			'Hello, we are not available at the moment, but we will get in touch with you by {date}.',
		leadformBusinessHoursMessage:
			'Hello, thank you for submitting the form. Our team will respond shortly.',
		leadformAfterHoursMessage:
			'Hello, we are not available at the moment, but we will get in touch with you by {date}.',
		businessHours: {
			sunday: { isOpen: false, hours: null },
			monday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
			tuesday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
			wednesday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
			thursday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
			friday: { isOpen: true, hours: '8:00 AM - 6:00 PM' },
			saturday: { isOpen: false, hours: null }
		}
	};
}
