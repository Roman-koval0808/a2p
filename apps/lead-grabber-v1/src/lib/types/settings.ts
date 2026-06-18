export interface AutoReplySettings {
	textAutoReply: boolean;
	businessHoursMessage: string;
	afterHoursMessage: string;
	leadformBusinessHoursMessage: string;
	leadformAfterHoursMessage: string;
	businessHours: {
		[key: string]: {
			isOpen: boolean;
			hours: string | null;
		};
	};
}
