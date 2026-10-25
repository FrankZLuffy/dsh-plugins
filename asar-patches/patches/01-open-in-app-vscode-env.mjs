/**
 * 01 — stop the desktop shell's ELECTRON_RUN_AS_NODE from leaking into "Open In".
 *
 * The desktop shell starts the dsh server with ELECTRON_RUN_AS_NODE=1. The old
 * launchDetachedApp passed the scrubbed parent environment straight to the app
 * it launched, so VS Code (Code.exe) started in Node mode, tried to execute the
 * workspace directory as a script, exited nonzero, and the Open In request
 * failed. A child env is now built by launchEnvironment(), which drops that one
 * variable; an adapter that really wants Node mode still sets it explicitly in
 * options.env, and that explicit value wins.
 */
export const id = '01-open-in-app-vscode-env';

export const title = 'Open In: do not inherit ELECTRON_RUN_AS_NODE (VS Code launches in Node mode)';

export const entries = {
  host: 'dsh/node_modules/@deepseek-ai/dsh-host-open-in-app/lib/index.js',
};

const ANCHOR = 'const launchDetachedApp = (command, args, options) => new Promise((resolve, reject) => {';

const HELPER = [
  '/** Adapter env without Electron Node mode. */',
  'function launchEnvironment(explicit) {',
  '\tconst env = scrubbedParentEnv();',
  '\tfor (const key of Object.keys(env)) if (key.toUpperCase() === "ELECTRON_RUN_AS_NODE") delete env[key];',
  '\treturn { ...env, ...explicit };',
  '}',
].join('\n');

const ENV_BEFORE = ['\t\tenv: {', '\t\t\t...scrubbedParentEnv(),', '\t\t\t...options.env', '\t\t}'].join('\n');
const ENV_AFTER = '\t\tenv: launchEnvironment(options.env)';

export const edits = [
  {
    id: 'add-launch-environment-helper',
    entry: 'host',
    note: 'Insert the env builder directly above launchDetachedApp.',
    find: ANCHOR,
    replace: `${HELPER}\n${ANCHOR}`,
    marker: 'function launchEnvironment(explicit)',
  },
  {
    id: 'use-launch-environment',
    entry: 'host',
    note: 'Route the spawn env through the helper instead of spreading the raw parent env.',
    find: ENV_BEFORE,
    replace: ENV_AFTER,
    marker: ENV_AFTER,
  },
];
