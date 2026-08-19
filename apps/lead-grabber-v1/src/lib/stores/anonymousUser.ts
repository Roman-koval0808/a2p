import { writable, type Writable } from "svelte/store";

export const anonymousUser: Writable<string> = writable('');