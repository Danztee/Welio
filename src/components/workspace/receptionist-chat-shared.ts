import { type ChatState } from "@/lib/receptionist/contract";

export const empty: ChatState = { turns: [], pending: null, receipt: null };

export type SendAction = (action: Record<string, unknown>) => Promise<boolean>;
