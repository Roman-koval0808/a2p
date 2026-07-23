import { prisma } from '../db';

export class TimerService {
    private isRunning = false;
    private timerId: NodeJS.Timeout | null = null;
    private intervalMs: number;

    constructor(intervalMs: number = 30000) {
        this.intervalMs = intervalMs;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.poll();
    }

    stop() {
        this.isRunning = false;
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
    }

    private async poll() {
        if (!this.isRunning) return;

        try {
            const now = new Date();
            const pendingTimers = await prisma.actionTimer.findMany({
                where: {
                    status: 'pending',
                    fires_at: { lte: now }
                },
                include: {
                    container: {
                        include: {
                            tasks: true,
                            approvals: true
                        }
                    }
                }
            });

            for (const timer of pendingTimers) {
                const container = timer.container;
                
                // Closure Guards (Section 1.2)
                let blockClosure = false;
                
                // 1. Active SLA exists (deadline is in future)
                if (container.sla_deadline && container.sla_deadline > now) blockClosure = true;
                // 2. Unfulfilled promise_made task
                if (container.tasks.some(t => t.category === 'customer_promise' && t.status === 'open')) blockClosure = true;
                // 3. Customer-facing draft awaiting approval
                if (container.approvals.some(a => a.state === 'pending')) blockClosure = true;
                // 4. Tentative calendar hold is active (Requires querying SlotHold or similar, we'll mark TODO)
                // 5. closure_policy == indefinite
                if (container.closure_policy === 'indefinite') blockClosure = true;

                if (timer.type === 'thread_inactivity' && blockClosure) {
                    console.log(`[TimerService] Skipping thread_inactivity for ${container.comm_id} due to closure guards.`);
                    continue;
                }

                console.log(`[TimerService] Firing timer ${timer.timer_id} of type ${timer.type} for comm_id ${timer.comm_id}`);
                
                // Update status to fired
                await prisma.actionTimer.update({
                    where: { timer_id: timer.timer_id },
                    data: { status: 'fired' }
                });

                // Inject synthetic Event into Stage 1 Intake.
                // We'll dispatch this to the Pipeline orchestrator.
                try {
                    // TODO: call the new A2P Pipeline handler here
                    // await processA2POrchestrator(timer.comm_id, timer.type);
                } catch (e) {
                    console.error(`[TimerService] Error processing timer ${timer.timer_id}:`, e);
                }
            }
        } catch (error) {
            console.error('[TimerService] Polling error:', error);
        } finally {
            if (this.isRunning) {
                this.timerId = setTimeout(() => this.poll(), this.intervalMs);
            }
        }
    }
}

export const timerService = new TimerService();

export async function createTimer(data: {
    comm_id: string;
    type: string;
    fires_at: Date;
    condition_payload?: any;
}) {
    return prisma.actionTimer.create({
        data: {
            comm_id: data.comm_id,
            type: data.type,
            fires_at: data.fires_at,
            condition_payload: data.condition_payload ?? {},
            status: 'pending'
        }
    });
}
