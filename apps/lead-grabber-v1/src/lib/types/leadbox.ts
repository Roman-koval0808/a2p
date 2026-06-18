export interface LeadboxData {
	logoImage: string;
	leadBoxOpen: boolean;
	channels: Channel[];
	primaryIconOnly?: boolean;
	secondaryButton?: {
		text: string;
		icon?: string;
		showIcon?: boolean;
	};
}

export interface Channel {
	id: string;
	name: string;
	value: string;
	url: string;
	buttonColor: string;
	icon?: string;
	showIcon?: boolean;
	target?: string;
}

export interface Leadbox {
	id: string;
	leadbox_data: LeadboxData | string;
	owner?: string;
}
