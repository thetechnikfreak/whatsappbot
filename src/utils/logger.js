const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function timestamp() {
  return new Date().toLocaleTimeString('de-DE', { hour12: false });
}

function format(level, color, ...args) {
  const ts = `${COLORS.gray}${timestamp()}${COLORS.reset}`;
  const tag = `${color}${COLORS.bold}[${level}]${COLORS.reset}`;
  console.log(ts, tag, ...args);
}

const logger = {
  info: (...args) => format('INFO', COLORS.green, ...args),
  warn: (...args) => format('WARN', COLORS.yellow, ...args),
  error: (...args) => format('ERROR', COLORS.red, ...args),
  mod: (...args) => format('MOD', COLORS.magenta, ...args),
  cmd: (...args) => format('CMD', COLORS.cyan, ...args),
};

export default logger;
