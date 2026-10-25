/**
 * 02 — add Typora to the "Open In" catalog and make it the remembered default.
 *
 * Host: a win32-only catalog entry resolved through the App Paths registry key,
 * then the Typora uninstall record, then the two usual install directories.
 * Typora accepts a directory path (`typora <dir>`), so the workspace split
 * button works with it unchanged.
 *
 * Client: the label key and product name for the menu, plus a new persisted
 * choice key (`dsh.open-in-app.choice.typora`) whose initial value is "typora".
 * The old remembered choice is deliberately ignored once, so Typora becomes the
 * default on the first render; picking another app still persists as before.
 */
export const id = '02-open-in-app-typora';

export const title = 'Open In: add Typora and make it the default editor for workspaces';

export const entries = {
  host: 'dsh/node_modules/@deepseek-ai/dsh-host-open-in-app/lib/index.js',
  client: 'dsh/node_modules/@deepseek-ai/dsh-client-ui-open-in-app/lib/client.js',
};

const WINDSURF_ANCHOR = ['\t{', '\t\tid: "windsurf",'].join('\n');

const TYPORA_ENTRY = [
  '\t{',
  '\t\tid: "typora",',
  '\t\tplatforms: { win32: spec(appPaths("Typora.exe"), installRecord("Typora"), file(["${ProgramFiles}/Typora/Typora.exe", "${LOCALAPPDATA}/Programs/Typora/Typora.exe"])) }',
  '\t},',
].join('\n');

const LABEL_ANCHOR = '\t\t\tvscodeinsiders: "app.vscodeinsiders",\n';
const LABEL_ADDED = '\t\t\ttypora: "app.typora",\n';

const PRODUCT_ANCHOR = '\t\t\t"app.vscodeinsiders": "VS Code Insiders",\n';
const PRODUCT_ADDED = '\t\t\t"app.typora": "Typora",\n';

const CHOICE_BEFORE =
  'createSnapshotStore)("", { persist: { name: "dsh.open-in-app.choice" } })';
const CHOICE_AFTER =
  'createSnapshotStore)("typora", { persist: { name: "dsh.open-in-app.choice.typora" } })';

export const edits = [
  {
    id: 'catalog-entry',
    entry: 'host',
    note: 'Typora sits in the editor group, right before windsurf.',
    find: WINDSURF_ANCHOR,
    replace: `${TYPORA_ENTRY}\n${WINDSURF_ANCHOR}`,
    marker: 'id: "typora",',
  },
  {
    id: 'label-key',
    entry: 'client',
    note: 'Label key used by the split button and the menu.',
    find: LABEL_ANCHOR,
    replace: `${LABEL_ANCHOR}${LABEL_ADDED}`,
    marker: 'typora: "app.typora",',
  },
  {
    id: 'product-name',
    entry: 'client',
    note: 'Product name shown verbatim in both dictionaries.',
    find: PRODUCT_ANCHOR,
    replace: `${PRODUCT_ANCHOR}${PRODUCT_ADDED}`,
    marker: '"app.typora": "Typora",',
  },
  {
    id: 'default-choice',
    entry: 'client',
    note: 'New storage key + initial value, so Typora wins the first render.',
    find: CHOICE_BEFORE,
    replace: CHOICE_AFTER,
    marker: 'dsh.open-in-app.choice.typora',
  },
];
