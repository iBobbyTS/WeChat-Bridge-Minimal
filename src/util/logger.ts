export type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
};

export function createStderrLogger(debugEnabled = false): Logger {
  const write = (level: string, message: string) => {
    process.stderr.write(`${new Date().toISOString()} ${level} ${message}\n`);
  };
  return {
    info: (message) => write("INFO", message),
    warn: (message) => write("WARN", message),
    error: (message) => write("ERROR", message),
    debug: (message) => {
      if (debugEnabled) {
        write("DEBUG", message);
      }
    },
  };
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
