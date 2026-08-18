export interface LeadboxData {
	logoImage: string;
	leadBoxOpen: boolean;
	channels: Channel[];
	primaryIconOnly?: boolean;
	secondaryButton?: {
		text: string;
		icon?: string;
		showIcon?: boolean;
		buttonColor?: string;
		fontColor?: string;
		url?: string;
	};
	topBanner?: {
		text: string;
		backgroundColor: string;
		fontColor: string;
		fontFamily: string;
	};
	closedState?: {
		bannerText?: string;
		bannerBgColor?: string;
		bannerFontColor?: string;
		buttonText?: string;
		buttonBgColor?: string;
		buttonFontColor?: string;
		iconColor?: string;
		icon?: string;
	};
}

export interface Channel {
	id: string;
	name: string;
	value: string;
	type?: 'link' | 'text_us' | 'request_call';
	url?: string;
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
