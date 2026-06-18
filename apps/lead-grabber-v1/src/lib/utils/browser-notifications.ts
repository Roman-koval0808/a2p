/** Request browser notification permission. Call from user gesture or on notifications page. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
	if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
	if (Notification.permission === 'granted') return 'granted';
	if (Notification.permission === 'denied') return 'denied';
	return await Notification.requestPermission();
}

/** Show a desktop notification. No-op if permission not granted or outside browser. */
export function showDesktopNotification(title: string, options?: { body?: string; icon?: string }) {
	if (
		typeof window === 'undefined' ||
		!('Notification' in window) ||
		Notification.permission !== 'granted'
	)
		return;
	try {
		const n = new Notification(title, {
			body: options?.body,
			icon: options?.icon ?? '/icons/main-logo.svg'
		});
		n.onclick = () => {
			window.focus();
			n.close();
		};
	} catch (_) {}
}
