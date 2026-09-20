const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const forbidden = /stripe|current_period|subscription|basil|acacia|dahlia|stripe-signature|customer\.subscription/i;

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) ? [target] : [];
  });
}

test('portable package source contains no provider vocabulary', () => {
  const violations = fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const source = path.join(root, 'packages', entry.name, 'src');
      return fs.existsSync(source) ? sourceFiles(source) : [];
    })
    .flatMap(file => fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .map((line, index) => ({ file: path.relative(root, file), line: index + 1, text: line }))
      .filter(item => forbidden.test(item.text)));
  assert.deepEqual(violations, [], violations.map(item => `${item.file}:${item.line}: ${item.text.trim()}`).join('\n'));
});
