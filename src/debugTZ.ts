// utils/debugTZ.ts
import debug, { Debugger } from 'debug';

// Disable debug's built-in timestamp
process.env.DEBUG_HIDE_DATE = '1';

// Save original log function
const originalLog = debug.log;

// Override debug.log to remove UTC timestamp completely
debug.log = function (...args: any[]) {
  // args already contain our formatted message from formatArgs
  originalLog.apply(this, args);
};

// const originalFormatArgs = debug.formatArgs;

debug.formatArgs = function formatArgs(this: Debugger, args: any[]): void {
  const tz = process.env.TZ || undefined;

  const now = new Date();
  const local = now.toLocaleString('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Build a Pino-like prefix
  const prefix = `[${local}]`;

  // Replace debug's default formatting entirely
  args[0] = `${prefix} ${this.namespace} ${args[0]}`;

  // Do NOT call originalFormatArgs — it adds UTC timestamps
};

export default debug;
export { debug };
