// Message type definition for the application
export interface Message {
	id: string;
	thread_id: string;
	customer_name?: string;
	customer_phone?: string;
	customer_email?: string;
	status: 'new' | 'read' | 'unread' | 'replied' | 'assigned' | 'closed';
	company_id: string;
	assigned_to?: string;
	created: string;
	updated: string;
	initials?: string;
	color?: string;
	messages: {
		content: string;
		timestamp: string;
		is_agent_reply: boolean;
		agent_id?: string;
		agent_name?: string;
		media?: {
			url: string;
			content_type: string;
		}[];
	}[];
	urgency?: 'green' | 'blue' | 'red';
	urgencyScore?: number;
	sentiment?: string;
	intent?: string;
	aiSummary?: string;
	draftResponse?: string;
}
