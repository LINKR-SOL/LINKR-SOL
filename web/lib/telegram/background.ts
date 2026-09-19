/**
 * Work that outlives the update that started it (a launch, a withdrawal). On Vercel the webhook route installs
 * a runner built on `after()`, so Telegram gets its 200 at once and the work continues within the route's
 * maxDuration; the local long-polling script keeps the default, which just lets the promise run.
 */
type Runner = (task: () => Promise<void>) => void;

let runner: Runner = (task) => {
  void task();
};

export function setBackgroundRunner(r: Runner): void {
  runner = r;
}

export function background(label: string, task: () => Promise<void>): void {
  runner(async () => {
    try {
      await task();
    } catch (e) {
      console.error(`[telegram:${label}]`, e);
    }
  });
}
