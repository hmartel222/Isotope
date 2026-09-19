const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { schemas, JsonValueSchema, deterministicJson } = require('../packages/core/dist');
const directory = join(__dirname, '../packages/core/schemas');
mkdirSync(directory, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const filename = name === 'ChangeSpec' ? 'changespec' : name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const json = JSON.parse(JSON.stringify(schema).replaceAll('"$ref":"JsonValue"', '"$ref":"#/definitions/JsonValue"'));
  const recursive = JSON.parse(JSON.stringify(JsonValueSchema).replaceAll('"$ref":"JsonValue"', '"$ref":"#/definitions/JsonValue"'));
  delete recursive.$id;
  writeFileSync(join(directory, `${filename}.schema.json`), deterministicJson({ $schema: 'http://json-schema.org/draft-07/schema#', ...json, definitions: { JsonValue: recursive } }));
}
