/**
 * Running one tick at a time, forever.
 *
 * Its own module, with the timer injected, so the re-entrancy rule can be
 * tested. Two ticks in flight both read the state before either writes it, so
 * both would decide to reload — and each schedules its own successor, leaving
 * the loop permanently forked with a timer nobody holds.
 */

export interface LoopHost {
	/** One tick. Rejections are reported, never allowed to end the loop. */
	run(): Promise<void>;
	/** How long to wait before the next tick, read fresh each time. */
	delayMs(): number;
	/** Somewhere for an unexpected failure to go, so it is never silent. */
	onError(err: unknown): void;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export class Loop {
	private timer: unknown;
	private running: Promise<void> | undefined;
	private stopped = false;

	constructor(private readonly host: LoopHost) {}

	start(): void {
		this.schedule(0);
	}

	stop(): void {
		this.stopped = true;
		this.host.clearTimeout(this.timer);
		this.timer = undefined;
	}

	/**
	 * Runs a tick now, out of band.
	 *
	 * Joins the tick already in flight rather than starting a second one: the
	 * person most likely to ask for this is someone staring at a disconnected
	 * window, which is exactly when a tick is slowest and a race most likely.
	 */
	async runNow(): Promise<void> {
		this.host.clearTimeout(this.timer);
		this.timer = undefined;
		await this.tick();
	}

	private schedule(delayMs: number): void {
		if (this.stopped) {
			return;
		}
		this.timer = this.host.setTimeout(() => {
			this.timer = undefined;
			void this.tick();
		}, delayMs);
	}

	private tick(): Promise<void> {
		// A tick already under way is the tick: joining it keeps the loop single.
		this.running ??= this.host
			.run()
			.catch(err => this.host.onError(err))
			.finally(() => {
				this.running = undefined;
				// Rescheduling here, after the catch, is what makes the loop
				// survive a failing tick instead of going quiet forever.
				if (this.timer === undefined) {
					this.schedule(this.host.delayMs());
				}
			});
		return this.running;
	}
}
